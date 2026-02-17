sap.ui.define([
    "com/nexus/asset/controller/BaseController",
    "sap/m/MessageBox"
], (BaseController, MessageBox) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Master", {
        onInit() {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.attachRoutePatternMatched(this.onRouteMatched, this);
            }
        },
        onRouteMatched: function () {
            this.setBusyOn();
            this.getLocalDataModel().setProperty("/treeTable", []);
            this.getoHashToken().done(function (result) {
                this.hash = result.hash
                $.ajax({
                    "url": "/bo/Comp_view/",
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": this.hash
                    },
                    "success": function (response) {
                        this.getLocalDataModel().setProperty("/treeList", response.rows || []);
                        this.setBusyOff();
                    }.bind(this),
                    "error": function (errorData) {
                        MessageBox.error("Error while fetching data");
                        this.setBusyOff();
                    }.bind(this)
                });
            }.bind(this));
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
            this.getLocalDataModel().setProperty("/selectedNodeData", oSelectedNode || null);
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
                            return Object.assign({}, oRow, {
                                Name: sAssetName,
                                Has_Children: bHasChild,
                                rows: aChildRows
                            });
                        });
                        this.getLocalDataModel().setProperty("/treeTable", aRows);
                        this.setBusyOff();
                    }.bind(this),
                    "error": function (errorData) {
                        MessageBox.error("Error while fetching data");
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
                        return Object.assign({}, oRow, {
                            Name: sAssetName,
                            Has_Children: bHasChild,
                            rows: aChildRows
                        });
                    });
                    this.getLocalDataModel().setProperty(sPath, aRows);
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