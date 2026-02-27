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
        onRouteMatched: function () {
            this.setBusyOn();
            this.getLocalDataModel().setProperty("/treeTable", []);
            this._compTypeMap = {};
            this.getoHashToken().done(function (result) {
                this.hash = result.hash;
                // Fetch Comp_Type to build CT_ID -> Name map
                $.ajax({
                    "url": "/bo/Comp_Type/",
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": this.hash
                    },
                    "success": function (compTypeResponse) {
                        var aCompTypes = Array.isArray(compTypeResponse && compTypeResponse.rows) ? compTypeResponse.rows : [];
                        aCompTypes.forEach(function (oType) {
                            if (oType.CT_ID !== undefined && oType.CT_ID !== null) {
                                this._compTypeMap[oType.CT_ID] = oType.Name || "";
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
            $.ajax({
                "url": "/bo/Comp_view/",
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
            this.getLocalDataModel().setProperty("/selectedNodeData", oSelectedNode || null);
            //this._mergeParentIfMissing(oSelectedNode);
            this.setBusyOn();
            // roote api call
            $.ajax({
                "url": "/bo/View_Node/",
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
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = oRow.CT_ID || "";
                        var sAssetType = (sCtId && this._compTypeMap[sCtId]) ? this._compTypeMap[sCtId] : sCtId;
                        return Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                    }.bind(this));
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
            if (sCompoonentID) {
                oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sCompoonentID);
            } else {
                oLocalDataModel.setProperty("/shareUrl", this.getResourceBundle().getText("tooltipShareNavigate"));
            }

            this.fetchDetailTiles(sCtId, sCompoonentID, this.hash);
        },
        onToggleOpenState: function (oEvent) {
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
                "url": "/bo/View_Node/",
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
                    aRows = aRows.map(function (oRow) {
                        var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                        var bHasChild = oRow.Has_Children === true;
                        var aChildRows = bHasChild ? [{ rows: [] }] : [];
                        var sCtId = oRow.CT_ID || "";
                        var sAssetType = (sCtId && this._compTypeMap[sCtId]) ? this._compTypeMap[sCtId] : sCtId;
                        return Object.assign({}, oRow, {
                            Name: sAssetName,
                            AssetType: sAssetType,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
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