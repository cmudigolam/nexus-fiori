sap.ui.define([
    "com/nexus/asset/controller/BaseController",
    "sap/m/MessageBox"
], (BaseController, MessageBox) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Master", {
        onInit() {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("Master").attachPatternMatched(this.onRouteMatched, this);
            }
            // Listen for breadcrumb selection events
            sap.ui.getCore().getEventBus().subscribe("Master", "FocusNodeFromBreadcrumb", this.focusNodeInTree, this);
            // Initialize duplicate tracker for performance optimization (ES5 compatible)
            this._nodeInfoMap = {}; // O(1) duplicate detection using object keys
            this._bNodeInfoMapValid = false; // O(1) flag instead of Object.keys() check
            
            // Monitor nodeInfoArray for changes to invalidate duplicate map
            var oLocalDataModel = this.getLocalDataModel();
            this._fnPropertyChangeListener = function(oEvent) {
                if (oEvent.getParameter("path") === "/nodeInfoArray") {
                    // Invalidate map when nodeInfoArray changes
                    this._bNodeInfoMapValid = false;
                }
            }.bind(this);
            oLocalDataModel.attachPropertyChange(this._fnPropertyChangeListener);
        },
        
        onExit: function() {
            // Clean up property change listener to prevent memory leak
            var oLocalDataModel = this.getLocalDataModel();
            if (oLocalDataModel && this._fnPropertyChangeListener) {
                oLocalDataModel.detachPropertyChange(this._fnPropertyChangeListener);
            }
        },
        
        /**
         * Normalize and ensure Full_Location property is consistent
         * @param {Object} oNode - Node object to normalize
         */
        _normalizeFullLocation: function(oNode) {
            if (!oNode) return;
            var sNormalized = this._getFullLocation(oNode);
            if (sNormalized && sNormalized !== oNode.Full_Location) {
                oNode.Full_Location = sNormalized;
            }
        },
        onAfterRendering: function () {
            var oTable = this.getView().byId("TreeTableBasic");
            if (oTable) {
                // Calculate visible rows based on available container height
                var oTableDom = oTable.getDomRef();
                if (oTableDom) {
                    var iContainerHeight = oTableDom.parentElement.offsetHeight;
                    var iRowHeight = 28; // Approximate row height in pixels
                    var iHeaderHeight = 80; // Approximate header/toolbar height
                    var iCalculatedRows = Math.max(10, Math.floor((iContainerHeight - iHeaderHeight) / iRowHeight));
                    oTable.setVisibleRowCount(iCalculatedRows);
                }
            }
        },
        onRouteMatched: function () {
            this.setBusyOn();
            this.getLocalDataModel().setProperty("/treeTable", []);
            this.getLocalDataModel().setProperty("/treeTableMinRows", 15);
            this._compTypeMap = {};
            var self = this;
            this.getoHashToken().done(function (result) {
                this.hash = result.hash;
                // Fetch Comp_Type to build CT_ID -> Name map
                $.ajax({
                    "url":  self.isRunninglocally()+ "/bo/Comp_Type/?pageSize=999",
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": this.hash
                    },
                    "success": function (response) {
                        var aCompTypes = Array.isArray(response && response.rows) ? response.rows : [];
                        aCompTypes.forEach(function (oType) {
                            if (oType.CT_ID !== undefined && oType.CT_ID !== null) {
                                // Convert CT_ID to string to ensure consistency with row CT_ID values
                                var sCtId = String(oType.CT_ID);
                                // Store the name or generate a display value from Type_Description if available
                                var sName = oType.Name || oType.Type_Description || oType.Description || oType.TypeName || "";
                                this._compTypeMap[sCtId] = sName;
                            }
                        }.bind(this));
                        this._loadCompView();
                    }.bind(this),
                    "error": function () {
                        // Continue loading even if Comp_Type fails
                        this._loadCompView();
                    }.bind(this)
                });
            }.bind(this));
        },

        _loadCompView: function () {
            var self = this;
            $.ajax({
                "url":  self.isRunninglocally()+ "/bo/Comp_view/",
                "method": "GET",
                "dataType": "json",
                "data": {
                    "hash": this.hash
                },
                "success": function (response) {
                    var aTreeList = response.rows || [];
                    this.getLocalDataModel().setProperty("/treeList", aTreeList);
                    if (aTreeList.length > 0) {
                        // Preserve previously selected asset if it still exists in the list
                        var sPreviousKey = this.getLocalDataModel().getProperty("/selectedNode");
                        var oSelectedNode = null;
                        if (sPreviousKey) {
                            oSelectedNode = aTreeList.find(function (oItem) {
                                return oItem.CV_ID === sPreviousKey;
                            });
                        }
                        if (!oSelectedNode) {
                            oSelectedNode = aTreeList[0];
                        }
                        this.getLocalDataModel().setProperty("/selectedNode", oSelectedNode.CV_ID);
                        this._loadRootNodes(oSelectedNode);
                        return;
                    }
                    this.getLocalDataModel().setProperty("/selectedNode", "");
                    this.getLocalDataModel().setProperty("/selectedNodeData", null);
                    this.getLocalDataModel().setProperty("/treeTable", []);
                    this.setBusyOff();
                }.bind(this),
                "error": function (errorData) {
                    MessageBox.error(this.getResourceBundle().getText("msgErrorFetchingData"));
                    this.setBusyOff();
                }.bind(this)
            });
        },
        onNodeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            if (!oItem) {
                return;
            }
            var oContext = oItem.getBindingContext("LocalDataModel");
            if (!oContext) {
                return;
            }
            var sPath = oContext.getPath();
            var oSelectedNode = this.getLocalDataModel().getProperty(sPath);
            this._loadRootNodes(oSelectedNode);
        },

        focusNodeInTree: function (sChannel, sEvent, oData) {
            var oNode = oData && oData.nodeData;
            if (!oNode || !oNode.CV_ID) {
                return;
            }
            
            var sTargetFullLocation = this._getFullLocation(oNode);
            if (!sTargetFullLocation) {
                return;
            }
            
            var oTreeTable = this.byId("TreeTableBasic");
            if (!oTreeTable) {
                return;
            }
            
            var oRowIndexMap = this._buildRowIndexMap(oTreeTable);
            if (oRowIndexMap.hasOwnProperty(sTargetFullLocation)) {
                var iRowIndex = oRowIndexMap[sTargetFullLocation];
                oTreeTable.setSelectedIndex(iRowIndex);
                return;
            }
            
            this._expandPathToNode(sTargetFullLocation, oTreeTable);
        },
        
        /**
         * Build index map of Full_Location -> row index for O(1) lookups
         * @param {Object} oTreeTable - TreeTable control
         * @returns {Object} Object with Full_Location as key, row index as value
         */
        _buildRowIndexMap: function(oTreeTable) {
            var oMap = {};
            var aRows = oTreeTable.getRows();
            for (var i = 0; i < aRows.length; i++) {
                var oRowContext = aRows[i].getBindingContext("LocalDataModel");
                if (oRowContext) {
                    var oRowData = oRowContext.getObject();
                    var sFullLocation = this._getFullLocation(oRowData);
                    if (sFullLocation) {
                        oMap[sFullLocation] = i;
                    }
                }
            }
            return oMap;
        },

        _expandPathToNode: function(sTargetFullLocation, oTreeTable) {
            if (!oTreeTable) {
                oTreeTable = this.byId("TreeTableBasic");
                if (!oTreeTable) return;
            }
            
            // Get path segments using shared utility method from BaseController
            var aPathSegments = this._getPathSegments(sTargetFullLocation);
            var aRows = oTreeTable.getRows();
            var oRowIndexMap = this._buildRowIndexMap(oTreeTable);
            
            // Pre-compute ancestor paths to avoid repeated slice() calls in loop
            var aAncestorPaths = [];
            for (var j = 0; j < aPathSegments.length - 1; j++) {
                aAncestorPaths.push(aPathSegments.slice(0, j + 1).join(" / "));
            }
            
            // Use pre-computed paths
            for (var i = 0; i < aAncestorPaths.length; i++) {
                var sAncestorPath = aAncestorPaths[i];
                
                if (oRowIndexMap.hasOwnProperty(sAncestorPath)) {
                    var iAncestorIndex = oRowIndexMap[sAncestorPath];
                    var oAncestorData = aRows[iAncestorIndex].getBindingContext("LocalDataModel").getObject();
                    
                    if (oAncestorData.Has_Children && !oTreeTable.isExpanded(iAncestorIndex)) {
                        oTreeTable.expand(iAncestorIndex);
                    }
                }
            }
            
            var self = this;
            // Capture the row index map in closure to avoid rebuilding it
            var fnSelectNode = function() {
                oTreeTable.detachEvent("rowsUpdated", fnSelectNode);
                // Rebuild map only because rows actually changed from expand() calls
                var oUpdatedMap = self._buildRowIndexMap(oTreeTable);
                if (oUpdatedMap.hasOwnProperty(sTargetFullLocation)) {
                    var iTargetIndex = oUpdatedMap[sTargetFullLocation];
                    oTreeTable.setSelectedIndex(iTargetIndex);
                }
            };
            oTreeTable.attachEvent("rowsUpdated", fnSelectNode);
        },

        _loadRootNodes: function (oSelectedNode) {
            if (!oSelectedNode || !oSelectedNode.CV_ID) {
                return;
            }
            var self = this;
            this.getLocalDataModel().setProperty("/selectedNodeData", oSelectedNode || null);
            //this._mergeParentIfMissing(oSelectedNode);
            this.setBusyOn();
            // roote api call
            $.ajax({
                "url":  self.isRunninglocally()+ "/bo/View_Node/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "X-NEXUS-Filter": '{"where":[{"field":"CV_ID","method":"eq","value":"' + oSelectedNode.CV_ID + '"}, {"field":"Link_ID"}]}'
                },
                "data": {
                    "hash": this.hash
                },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows : [];
                    var aMissingAssetTypes = [];
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = String(oRow.CT_ID || "");
                        var sAssetType = this._compTypeMap[sCtId] || sCtId;
                        // Track missing asset types for debugging
                        if (sCtId && !this._compTypeMap[sCtId] && aMissingAssetTypes.indexOf(sCtId) === -1) {
                            aMissingAssetTypes.push(sCtId);
                        }
                        var oMappedRow = Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                        this._normalizeFullLocation(oMappedRow);
                        return oMappedRow;
                    }.bind(this));
                    // Sort rows by Name in ascending order
                    aRows.sort(function(a, b) {
                        var nameA = (a.Name || "").toLowerCase();
                        var nameB = (b.Name || "").toLowerCase();
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
                    this.getLocalDataModel().setProperty("/treeTable", aRows);
                    
                    // Populate nodeInfoArray with root nodes so they're available for auto-selection
                    aRows.forEach(function(oRow) {
                        this.addNodeToInfoArr(oRow);
                    }.bind(this));
                    
                    // Collapse all root nodes after the TreeTable has processed the new data
                    var oTreeTable = this.byId("TreeTableBasic");
                    if (oTreeTable) {
                        oTreeTable.attachEventOnce("rowsUpdated", function () {
                            oTreeTable.collapseAll();
                            // Auto-select the first row ONLY on initial load (when treeTable was empty)
                            if (aRows && aRows.length > 0 && this.getLocalDataModel().getProperty("/treeTable").length === aRows.length) {
                                oTreeTable.setSelectedIndex(0);
                                // Trigger row selection manually to load tiles
                                var oFirstRowContext = oTreeTable.getContextByIndex(0);
                                if (oFirstRowContext) {
                                    var oFirstRow = oFirstRowContext.getProperty(oFirstRowContext.getPath());
                                    if (oFirstRow && oFirstRow.CT_ID) {
                                        var sCtId = oFirstRow.CT_ID;
                                        var sComponentID = oFirstRow.Component_ID;
                                        var oLocalDataModel = this.getLocalDataModel();
                                        oLocalDataModel.setProperty("/selectedNodeData", oFirstRow);
                                        oLocalDataModel.setProperty("/sCompoonentID", sComponentID);
                                        var sVnId = oFirstRow.VN_ID;
                                        if (sVnId) {
                                            oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sVnId);
                                        }
                                        // Fetch and load tiles for the first row
                                        this.fetchDetailTiles(sCtId, sComponentID, this.hash);
                                        // Publish event to update breadcrumbs
                                        sap.ui.getCore().getEventBus().publish("Detail", "UpdateBreadcrumb");
                                    }
                                }
                            }
                        }.bind(this));
                    }
                    this.setBusyOff();
                }.bind(this),
                "error": function (errorData) {
                    MessageBox.error(this.getResourceBundle().getText("msgErrorFetchingData"));
                    this.setBusyOff();
                }.bind(this)
            });
        },

        onRowSelect: function (oEvent) {
            var oTable = oEvent.getSource();
            var iSelectedIndex = oTable.getSelectedIndex();
            if (iSelectedIndex < 0) {
                return;
            }
            var oContext = oTable.getContextByIndex(iSelectedIndex);
            if (!oContext) {
                return;
            }
            var oSelectedRow = oContext.getProperty(oContext.getPath());
            if (!oSelectedRow || !oSelectedRow.CT_ID) {
                return;
            }

            // Update selectedNodeData to the selected row
            var oLocalDataModel = this.getLocalDataModel();
            oLocalDataModel.setProperty("/selectedNodeData", oSelectedRow);

            var sCtId = oSelectedRow.CT_ID;
            var sCompoonentID = oSelectedRow.Component_ID;
            oLocalDataModel.setProperty("/sCompoonentID", sCompoonentID);

            // Add selected row to nodeInfoArr if not present, remove duplicates by GUID and full_location
            this.addNodeToInfoArr(oSelectedRow);

            // Update share URL in model for tooltip binding
            var sVnId = oSelectedRow.VN_ID;
            if (sVnId) {
                oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sVnId);
            } else {
                oLocalDataModel.setProperty("/shareUrl", this.getResourceBundle().getText("tooltipShareNavigate"));
            }

            this.fetchDetailTiles(sCtId, sCompoonentID, this.hash);
            // Publish event to update breadcrumbs in Detail controller only after row selection
            sap.ui.getCore().getEventBus().publish("Detail", "UpdateBreadcrumb");
        },
        onToggleOpenState: function (oEvent) {
            var self = this;
            var iRowIndex = oEvent.getParameter("rowIndex");
            var oContext = oEvent.getParameter("rowContext");
            var bExpanded = oEvent.getParameter("expanded");
            if (!bExpanded || !oContext) {
                return;
            }
            var oSelectedRow = oContext.getProperty(oContext.getPath());
            if (!oSelectedRow || !oSelectedRow.Has_Children) {
                return;
            }
            // Skip if children are already loaded
            if (oSelectedRow.rows && oSelectedRow.rows.length > 0 && oSelectedRow.rows[0].VN_ID) {
                return;
            }
            var sCvId = oSelectedRow.CV_ID;
            var sRootVnId = oSelectedRow.VN_ID;
            var sPath = oContext.getPath() + "/rows";

            // Store full node object on expand, remove duplicates by GUID and full_location
            this.addNodeToInfoArr(oSelectedRow);

            this.setBusyOn();
            $.ajax({
                "url": self.isRunninglocally()+ "/bo/View_Node/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "X-NEXUS-Filter": '{"where":[{"field":"CV_ID","method":"eq","value":"' + sCvId + '"}, {"field":"Link_ID","value":' + sRootVnId + '}]}'
                },
                "data": {
                    "hash": this.hash
                },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows : [];
                    var aMissingAssetTypes = [];
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = String(oRow.CT_ID || "");
                        var sAssetType = this._compTypeMap[sCtId] || sCtId;
                        // Track missing asset types for debugging
                        if (sCtId && !this._compTypeMap[sCtId] && aMissingAssetTypes.indexOf(sCtId) === -1) {
                            aMissingAssetTypes.push(sCtId);
                        }
                        var oMappedRow = Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                        this._normalizeFullLocation(oMappedRow);
                        return oMappedRow;
                    }.bind(this));
                    if (aMissingAssetTypes.length > 0) {
                        console.warn("Child - Asset types missing names: ", aMissingAssetTypes);
                    }
                    aRows.sort(function(a, b) {
                        var nameA = (a.Name || "").toLowerCase();
                        var nameB = (b.Name || "").toLowerCase();
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
                    aRows.forEach(function(oRow) {
                        this.addNodeToInfoArr(oRow);
                    }.bind(this));
                    this.getLocalDataModel().setProperty(sPath, aRows);
                    this.setBusyOff();
                }.bind(this),
                "error": function (errorData) {
                    MessageBox.error(this.getResourceBundle().getText("msgErrorFetchingChildNodes"));
                    this.setBusyOff();
                }.bind(this)
            });
        },

        addNodeToInfoArr: function(nodeObj) {
            var oLocalDataModel = this.getLocalDataModel();
            var nodeInfoArr = oLocalDataModel.getProperty("/nodeInfoArray") || [];
            var fullLocation = this._getFullLocation(nodeObj);
            var guid = nodeObj.GUID || nodeObj.Guid || nodeObj.guid;
            
            if (!fullLocation || !guid) {
                return;
            }
            
            var sDuplicateKey = guid + ":" + fullLocation;
            
            if (!this._nodeInfoMap) {
                this._nodeInfoMap = {};
            }
            
            // Build map from existing array if needed (O(1) validity check instead of Object.keys())
            if (!this._bNodeInfoMapValid && nodeInfoArr.length > 0) {
                nodeInfoArr.forEach(function(n) {
                    var nGuid = n.GUID || n.Guid || n.guid;
                    var nLoc = this._getFullLocation(n);
                    this._nodeInfoMap[nGuid + ":" + nLoc] = true;
                }.bind(this));
                this._bNodeInfoMapValid = true;
            }
            
            // O(1) duplicate detection using object properties
            if (!this._nodeInfoMap[sDuplicateKey]) {
                nodeInfoArr.push(nodeObj);
                this._nodeInfoMap[sDuplicateKey] = true;
                oLocalDataModel.setProperty("/nodeInfoArray", nodeInfoArr);
            }
        }
    });
});