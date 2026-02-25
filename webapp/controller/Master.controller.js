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
                    this.getLocalDataModel().setProperty("/allNodes", aTreeList);
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
                    MessageBox.error("Error while fetching data");
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
                    MessageBox.error("Error while fetching data");
                    this.setBusyOff();
                }.bind(this)
            });
        },

        // _mergeParentIfMissing: function(node) {
        //     var oLocalDataModel = this.getLocalDataModel();
        //     var allNodes = oLocalDataModel.getProperty("/allNodes") || [];
        //     var nodeMap = {};
        //     allNodes.forEach(function(n) { nodeMap[n.CV_ID] = n; });
        //     function fetchParent(currentNode) {
        //         if (!currentNode || !currentNode.VN_ID || nodeMap[currentNode.VN_ID]) {
        //             return;
        //         }
        //         $.ajax({
        //             "url": "/bo/View_Node/",
        //             "method": "GET",
        //             "dataType": "json",
        //             "headers": {
        //                 "X-NEXUS-Filter": '{"where":[{"field":"CV_ID","method":"eq","value":"' + currentNode.VN_ID + '"}]}'
        //             },
        //             "data": {
        //                 "hash": oLocalDataModel.getProperty("/HashToken")
        //             },
        //             "success": function (response) {
        //                 var aRows = Array.isArray(response && response.rows) ? response.rows : [];
        //                 if (aRows.length > 0) {
        //                     var parent = aRows[0];
        //                     nodeMap[parent.CV_ID] = parent;
        //                     var mergedNodes = Object.values(nodeMap);
        //                     oLocalDataModel.setProperty("/allNodes", mergedNodes);
        //                     // Recursively fetch next ancestor
        //                     fetchParent(parent);
        //                 }
        //             }
        //         });
        //     }
        //     fetchParent(node);
        // },

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
            this.getLocalDataModel().setProperty("/selectedNodeData", oSelectedRow);
            // Publish breadcrumb update event
            sap.ui.getCore().getEventBus().publish("Detail", "UpdateBreadcrumb");
            
            var sCtId = oSelectedRow.CT_ID;
            var sCompoonentID = oSelectedRow.Component_ID;
            this.getLocalDataModel().setProperty("/sCompoonentID",sCompoonentID);
            this.setBusyOn();

            // First service call: get TD_IDs by CT_ID
            $.ajax({
                "url": "/bo/Info_Def/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "X-NEXUS-Filter": '{"where":[{"field":"CT_ID","method":"eq","value":"' + sCtId + '"}]}'
                },
                "data": {
                    "hash": this.hash
                },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows : [];
                    var aTdIds = aRows.map(function (row) {
                        return row.TD_ID;
                    }).filter(function (id) {
                        return id !== undefined && id !== null;
                    });
                    var oNextUIState = this.getOwnerComponent().getHelper().getNextUIState(1);
                    if (aTdIds.length === 0) {
                        this.getLocalDataModel().setProperty("/detailTiles", []);
                        this.getLocalDataModel().setProperty("/detailTileGroups", []);
                        this.setBusyOff();
                        this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
                        this.getRouter().navTo("Detail", { layout: oNextUIState.layout });
                        return;
                    }

                    // Update share URL in model for tooltip binding
                    var oLocalDataModel = this.getLocalDataModel();
                    if (oLocalDataModel.getProperty("/sCompoonentID")) {
                        oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sCompoonentID);
                    } else {
                        oLocalDataModel.setProperty("/shareUrl", "Share / Navigate");
                    }

                    // Second service call: get table definitions by TD_IDs
                    $.ajax({
                        "url": "/bo/Table_Def/",
                        "method": "GET",
                        "dataType": "json",
                        "headers": {
                            "X-NEXUS-Filter": '{"where":[{"field":"TD_ID","method":"in","items":[' + aTdIds.join(",") + ']}]}'
                        },
                        "data": {
                            "hash": this.hash
                        },
                        "success": function (response2) {
                            // Map TD_IDs to icons based on their order in aTdIds
                            var iconList = [
                                "sap-icon://home",
                                "sap-icon://account",
                                "sap-icon://employee",
                                "sap-icon://settings",
                                "sap-icon://document",
                                "sap-icon://calendar",
                                "sap-icon://customer",
                                "sap-icon://task",
                                "sap-icon://attachment",
                                "sap-icon://search",
                                "sap-icon://activities",
                                "sap-icon://activity-items"
                            ];
                            var tdIdToIcon = {};
                            aTdIds.forEach(function (tdId, idx) {
                                tdIdToIcon[tdId] = iconList[idx] || "sap-icon://hint";
                            });
                            var aTiles = (Array.isArray(response2 && response2.rows) ? response2.rows : []).map(function (tile) {
                                tile.icon = tdIdToIcon[tile.TD_ID] || "sap-icon://hint";
                                return tile;
                            });
                            var oCategoryMap = {};
                            aTiles.forEach(function (oTile) {
                                var sCategory = oTile.Category || oTile.category || "Uncategorized";
                                if (!oCategoryMap[sCategory]) {
                                    oCategoryMap[sCategory] = [];
                                }
                                oCategoryMap[sCategory].push(oTile);
                            });
                            var aTileGroups = Object.keys(oCategoryMap).sort().map(function (sCategory) {
                                return {
                                    Category: sCategory,
                                    tiles: oCategoryMap[sCategory]
                                };
                            });
                            this.getLocalDataModel().setProperty("/detailTiles", aTiles);
                            this.getLocalDataModel().setProperty("/detailTileGroups", aTileGroups);
                            this.setBusyOff();
                            this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
                            this.getRouter().navTo("Detail", { layout: oNextUIState.layout });
                        }.bind(this),
                        "error": function () {
                            MessageBox.error("Error while fetching table definitions");
                            this.setBusyOff();
                        }.bind(this)
                    });
                }.bind(this),
                "error": function () {
                    MessageBox.error("Error while fetching info definitions");
                    this.setBusyOff();
                }.bind(this)
            });
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
                    // Merge new nodes into /allNodes
                    var allNodes = this.getLocalDataModel().getProperty("/allNodes") || [];
                    var nodeMap = {};
                    allNodes.forEach(function(n) { nodeMap[n.CV_ID] = n; });
                    aRows.forEach(function(n) { nodeMap[n.CV_ID] = n; });
                    var mergedNodes = Object.values(nodeMap);
                    this.getLocalDataModel().setProperty("/allNodes", mergedNodes);
                    this.setBusyOff();
                }.bind(this),
                "error": function (errorData) {
                    MessageBox.error("Error while fetching child nodes");
                    this.setBusyOff();
                }.bind(this)
            });
        }
    });
});