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
                    "url":  self.isRunninglocally()+ "/bo/Comp_Type/",
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": this.hash
                    },
                    "success": function (response) {
                        var aCompTypes = Array.isArray(response && response.rows) ? response.rows : [];
                        console.log("Comp_Type Response - Total types:", aCompTypes.length);
                        console.log("Comp_Type Full Response:", aCompTypes);
                        aCompTypes.forEach(function (oType) {
                            if (oType.CT_ID !== undefined && oType.CT_ID !== null) {
                                // Convert CT_ID to string to ensure consistency with row CT_ID values
                                var sCtId = String(oType.CT_ID);
                                // Store the name or generate a display value from Type_Description if available
                                var sName = oType.Name || oType.Type_Description || oType.Description || oType.TypeName || "";
                                this._compTypeMap[sCtId] = sName;
                                // Log entries for asset types 2109 and 2296 specifically
                                if (sCtId === "2109" || sCtId === "2296") {
                                    console.log("Asset Type " + sCtId + ":", oType, "Name stored:", sName);
                                }
                            }
                        }.bind(this));
                        console.log("Comp_Type Map Built:", this._compTypeMap);
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
                    console.log("Root Assets Loaded - Count:", aRows.length);
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = String(oRow.CT_ID || "");
                        var sAssetType = this._compTypeMap[sCtId] || sCtId;
                        // Track missing asset types for debugging
                        if (sCtId && !this._compTypeMap[sCtId] && aMissingAssetTypes.indexOf(sCtId) === -1) {
                            aMissingAssetTypes.push(sCtId);
                            console.log("Missing mapping for CT_ID:", sCtId, "Asset:", sAssetName, "Map keys:", Object.keys(this._compTypeMap));
                        }
                        // Log specific asset types
                        if (sCtId === "2109" || sCtId === "2296") {
                            console.log("Asset Type", sCtId, "-> Mapped to:", sAssetType, "Row CT_ID type:", typeof oRow.CT_ID, "Row:", oRow);
                        }
                        return Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                    }.bind(this));
                    // Log missing asset types for debugging
                    if (aMissingAssetTypes.length > 0) {
                        console.warn("Asset types missing names: ", aMissingAssetTypes);
                    } else {
                        console.log("All asset types found in mapping");
                    }
                    // Sort rows by Name in ascending order
                    aRows.sort(function(a, b) {
                        var nameA = (a.Name || "").toLowerCase();
                        var nameB = (b.Name || "").toLowerCase();
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
                    this.getLocalDataModel().setProperty("/treeTable", aRows);
                    // Collapse all root nodes after the TreeTable has processed the new data
                    var oTreeTable = this.byId("TreeTableBasic");
                    if (oTreeTable) {
                        oTreeTable.attachEventOnce("rowsUpdated", function () {
                            oTreeTable.collapseAll();
                        });
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
                    console.log("Child Assets Loaded for CV_ID:", sCvId, "Count:", aRows.length);
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = String(oRow.CT_ID || "");
                        var sAssetType = this._compTypeMap[sCtId] || sCtId;
                        // Track missing asset types for debugging
                        if (sCtId && !this._compTypeMap[sCtId] && aMissingAssetTypes.indexOf(sCtId) === -1) {
                            aMissingAssetTypes.push(sCtId);
                            console.log("Missing mapping for CT_ID:", sCtId, "Asset:", sAssetName, "Map keys:", Object.keys(this._compTypeMap));
                        }
                        // Log specific asset types
                        if (sCtId === "2109" || sCtId === "2296") {
                            console.log("Asset Type", sCtId, "-> Mapped to:", sAssetType, "Row CT_ID type:", typeof oRow.CT_ID, "Row:", oRow);
                        }
                        return Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                    }.bind(this));
                    // Log missing asset types for debugging
                    if (aMissingAssetTypes.length > 0) {
                        console.warn("Child - Asset types missing names: ", aMissingAssetTypes);
                    }
                    // Sort rows by Name in ascending order
                    aRows.sort(function(a, b) {
                        var nameA = (a.Name || "").toLowerCase();
                        var nameB = (b.Name || "").toLowerCase();
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
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
            var fullLocation = nodeObj.Full_Location || nodeObj.Full_location || nodeObj.full_location || nodeObj.FullLocation || "";
            var guid = nodeObj.GUID || nodeObj.Guid || nodeObj.guid;
            var exists = nodeInfoArr.some(function(n) {
                var nGuid = n.GUID || n.Guid || n.guid;
                var nLoc = n.Full_Location || n.Full_location || n.full_location || n.FullLocation || "";
                return nGuid === guid && nLoc === fullLocation;
            });
            if (!exists && fullLocation && guid) {
                nodeInfoArr.push(nodeObj);
                oLocalDataModel.setProperty("/nodeInfoArray", nodeInfoArr);
            }
        }
    });
});