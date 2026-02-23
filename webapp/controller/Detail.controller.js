sap.ui.define([
    "com/nexus/asset/controller/BaseController",
    "sap/m/MessageToast",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/Input",
    "sap/m/DatePicker",
    "sap/m/CheckBox",
    "sap/m/ComboBox",
    "sap/m/VBox",
    "sap/ui/layout/form/SimpleForm"
], (BaseController, MessageToast, Fragment, JSONModel, Label, Text, Input, DatePicker, CheckBox, ComboBox, VBox, SimpleForm) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Detail", {
        onInit() {
            var oExitButton = this.getView().byId("exitFullScreenBtnMid"),
                oEnterButton = this.getView().byId("enterFullScreenBtnMid"),
                oLocalDataModel = this.getLocalDataModel();
            oLocalDataModel.setProperty("/shareUrl", "Share / Navigate");
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("Detail").attachPatternMatched(this.onRouteMatched, this);
            }
            [oExitButton, oEnterButton].forEach(function (oButton) {
                oButton.addEventDelegate({
                    onAfterRendering: function () {
                        if (this.bFocusFullScreenButton) {
                            this.bFocusFullScreenButton = false;
                            oButton.focus();
                        }
                    }.bind(this)
                });
            }, this);
            sap.ui.getCore().getEventBus().subscribe("Detail", "UpdateBreadcrumb", this.updateBreadcrumb, this);
        },
        onRouteMatched: function () {
            this.setBusyOff();
            //this.updateBreadcrumb();
        },
        updateBreadcrumb: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            var aBreadcrumb = [];
            if (oSelectedNode && oSelectedNode.CV_ID) {
                var fullLocation = oSelectedNode.Full_Location || oSelectedNode.Full_location || oSelectedNode.full_location || oSelectedNode.FullLocation || "";
                var segments = fullLocation ? fullLocation.split(" / ") : [];
                var allNodes = oLocalDataModel.getProperty("/allNodes") || [];
                // For each segment, reconstruct the path up to that segment and find the node with matching Full_Location
                var pathSoFar = [];
                segments.forEach(function(segment) {
                    pathSoFar.push(segment);
                    var segmentPath = pathSoFar.join(" / ");
                    var node = allNodes.find(function(n) {
                        var nodeFullLoc = n.Full_Location;
                        if (nodeFullLoc === segmentPath) {
                            return true;
                        };
                    });
                    aBreadcrumb.push({
                        name: segment,
                        CV_ID: node ? node.CV_ID : null
                    });
                });
            }
            oLocalDataModel.setProperty("/breadcrumb", aBreadcrumb);

            // Update share URL in model for tooltip binding
            if (oSelectedNode && oSelectedNode.Component_ID) {
                oLocalDataModel.setProperty("/shareUrl1", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + oSelectedNode.Component_ID);
            } else {
                oLocalDataModel.setProperty("/shareUrl1", "Share / Navigate");
            }
        },
        onBreadcrumbPress: function(oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            var oData = oContext.getObject();
            var oLocalDataModel = this.getLocalDataModel();
            var allNodes = oLocalDataModel.getProperty("/allNodes") || [];
            var targetCV_ID = oData && oData.CV_ID;
            if (!targetCV_ID) {
                return;
            }
            var oNode = allNodes.find(function(n) { return n.CV_ID === targetCV_ID; });
            if (!oNode || !oNode.CT_ID) {
                return;
            }
            oLocalDataModel.setProperty("/selectedNodeData", oNode);
            sap.ui.getCore().getEventBus().publish("Detail", "UpdateBreadcrumb");
            var sCtId = oNode.CT_ID;
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
                    "hash": this.getLocalDataModel().getProperty("/HashToken")
                },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows : [];
                    var aTdIds = aRows.map(function (row) {
                        return row.TD_ID;
                    }).filter(function (id) {
                        return id !== undefined && id !== null;
                    });
                    if (aTdIds.length === 0) {
                        oLocalDataModel.setProperty("/detailTiles", []);
                        oLocalDataModel.setProperty("/detailTileGroups", []);
                        this.setBusyOff();
                        return;
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
                            "hash": this.getLocalDataModel().getProperty("/HashToken")
                        },
                        "success": function (response2) {
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
                            aTdIds.forEach(function(tdId, idx) {
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
                            oLocalDataModel.setProperty("/detailTiles", aTiles);
                            oLocalDataModel.setProperty("/detailTileGroups", aTileGroups);
                            this.setBusyOff();
                        }.bind(this),
                        "error": function () {
                            MessageToast.show("Error while fetching table definitions");
                            this.setBusyOff();
                        }.bind(this)
                    });
                }.bind(this),
                "error": function () {
                    MessageToast.show("Error while fetching info definitions");
                    this.setBusyOff();
                }.bind(this)
            });
        },
        onTilePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            if (!oContext) {
                MessageToast.show("No tile context found");
                return;
            }

            var sTableName = oContext.getProperty("Table_Name");
            if (!sTableName) {
                MessageToast.show("Table name is missing");
                return;
            }

            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");
            this.setBusyOn();
            var fnCallTableApi = function (sResolvedHash) {
                this.setBusyOn();
                $.ajax({
                    "url": "/bo/" + encodeURIComponent(sTableName),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        oLocalDataModel.setProperty("/selectedTableName", sTableName);
                        oLocalDataModel.setProperty("/selectedTableData", response);
                        this.openDynamicFormDialog(sTableName, response);
                        this.setBusyOff();
                    }.bind(this),
                    "error": function () {
                        MessageToast.show("Error while fetching table data");
                        this.setBusyOff();
                    }.bind(this)
                });
            }.bind(this);

            if (sHash) {
                fnCallTableApi(sHash);
                return;
            }

            this.getoHashToken().done(function (oResult) {
                var sFetchedHash = oResult && oResult.hash;
                if (!sFetchedHash) {
                    MessageToast.show("Unable to fetch hash token");
                    return;
                }
                fnCallTableApi(sFetchedHash);
            }).fail(function () {
                MessageToast.show("Unable to fetch hash token");
            });
        },

        openDynamicFormDialog: function (sTableName, oFormData) {

            var oCategorizedFields = {};
            var aCategories = Array.isArray(oFormData && oFormData.categories) ? oFormData.categories : [];
            var aFields = Array.isArray(oFormData && oFormData.fields) ? oFormData.fields : [];

            aCategories.forEach(function (oCategory) {
                oCategorizedFields[oCategory.name] = [];
            });

            if (!aCategories.length) {
                oCategorizedFields.General = aFields.slice();
            } else {
                aFields.forEach(function (oField) {
                    if (oField.category && oCategorizedFields[oField.category]) {
                        oCategorizedFields[oField.category].push(oField);
                    }
                });
            }

            if (!aFields.length) {
                MessageToast.show("No fields available");
                return;
            }

            if (!aCategories.length) {
                oFormData.categories = [{ name: "General" }];
            } else {
                oFormData.categories.forEach(function (oCategory) {
                    if (!oCategorizedFields[oCategory.name]) {
                        oCategorizedFields[oCategory.name] = [];
                    }
                });
                aFields.forEach(function (oField) {
                    if (!oField.category) {
                        oCategorizedFields[oFormData.categories[0].name].push(oField);
                    }
                });
            }

            if (!Object.keys(oCategorizedFields).length) {
                oCategorizedFields.General = aFields.slice();
                oFormData.categories = [{ name: "General" }];
            }

            // Ensure each category has at least empty array
            oFormData.categories.forEach(function (oCategory) {
                if (!oCategorizedFields[oCategory.name]) {
                    oCategorizedFields[oCategory.name] = [];
                }
            });
            var self = this;
            // Create dialog content model
            var oDialogModel = {
                title: sTableName,
                formData: oFormData,
                categorizedFields: oCategorizedFields
            };
            // Load and open the dialog
            if (!self._oFormDialog) {
                self._oFormDialog = sap.ui.xmlfragment(
                    "com.nexus.asset.view.DynamicFormDialog",
                    self
                );
                self.getView().addDependent(self._oFormDialog);
            }

            var oModel = new JSONModel(oDialogModel);
            self._oFormDialog.setModel(oModel, "FormData");

            // Build form content dynamically
            self.buildFormContent(oFormData, oCategorizedFields);

            self._oFormDialog.open();
        },

        buildFormContent: function (oFormData, oCategorizedFields) {
            var oTabBar = this._oFormDialog.getContent()[0];
            oTabBar.destroyItems();

            var self = this;
            var aCategories = Array.isArray(oFormData && oFormData.categories) && oFormData.categories.length
                ? oFormData.categories
                : [{ name: "General" }];

            if (!oCategorizedFields.General && aCategories.length === 1 && aCategories[0].name === "General") {
                oCategorizedFields.General = Array.isArray(oFormData && oFormData.fields) ? oFormData.fields : [];
            }

            // Create a tab for each category
            aCategories.forEach(function (oCategory, iIndex) {
                var aFormContent = [];

                if (oCategorizedFields[oCategory.name] && oCategorizedFields[oCategory.name].length > 0) {
                    oCategorizedFields[oCategory.name].forEach(function (oField) {
                        // Add label
                        aFormContent.push(
                            new sap.m.Label({
                                text: oField.name || oField.fieldName,
                                required: oField.required || false
                            })
                        );

                        // Add input field based on field type
                        var oInput = self.createFieldControl(oField);
                        aFormContent.push(oInput);
                    });
                } else {
                    // No fields for this category
                    aFormContent.push(
                        new sap.m.Text({
                            text: "No fields available for this category",
                            class: "sapUiMediumMargin"
                        })
                    );
                }

                // Create SimpleForm for this category
                var oSimpleForm = new sap.ui.layout.form.SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout",
                    content: aFormContent
                });

                // Create ScrollContainer for the form
                var oScrollContainer = new sap.m.ScrollContainer({
                    vertical: true,
                    horizontal: true,
                    content: [oSimpleForm]
                });

                // Create tab for this category
                var oTab = new sap.m.IconTabFilter({
                    text: oCategory.name,
                    key: "tab" + iIndex,
                    content: [oScrollContainer]
                });

                oTabBar.addItem(oTab);
            });
        },

        createFieldControl: function (oField) {
            // Create appropriate control based on field type
            switch (oField.fieldTypeId) {
                case 9: // Date field
                    return new sap.m.DatePicker({
                        placeholder: oField.name || oField.fieldName,
                        valueFormat: "yyyy-MM-dd"
                    });
                case 5: // Boolean field
                    return new sap.m.CheckBox({
                        text: ""
                    });
                case 6: // Numeric field
                    return new sap.m.Input({
                        type: "Number",
                        placeholder: oField.name || oField.fieldName
                    });
                case 37: // Lookup/Dropdown field
                    return new sap.m.ComboBox({
                        placeholder: oField.name || oField.fieldName
                    });
                case 38: // Sub-table
                    return new sap.m.Input({
                        placeholder: oField.name || oField.fieldName,
                        enabled: false
                    });
                default: // Text field
                    return new sap.m.Input({
                        type: "Text",
                        placeholder: oField.name || oField.fieldName
                    });
            }
        },

        getFieldInputType: function (oField) {
            // Map field types to SAP UI5 input types
            if (oField.fieldTypeId === 9) {
                return "Date"; // Date field
            } else if (oField.fieldTypeId === 5) {
                return "Text"; // Boolean - would ideally be a checkbox
            } else if (oField.fieldTypeId === 6) {
                return "Number"; // Numeric field
            } else {
                return "Text"; // Default to text
            }
        },

        onFormDialogClose: function () {
            if (this._oFormDialog) {
                this._oFormDialog.close();
            }
        },

        onFormSave: function () {
            MessageToast.show("Form data saved successfully!");
            if (this._oFormDialog) {
                this._oFormDialog.close();
            }
        },




        onSharePress: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            if (!oSelectedNode || !oSelectedNode.CV_ID) {
                MessageToast.show("No asset selected");
                return;
            }
            var sUrl = "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + encodeURIComponent(oSelectedNode.CV_ID);
            window.open(sUrl, "_blank");
        },

        onTileSharePress: function (oEvent) {
            var oContext = oEvent.getSource().getParent().getItems()[0].getBindingContext("LocalDataModel");
            if (oContext) {
                var sTileName = oContext.getProperty("Name");
                var sUrl = window.location.href;
                var sShareUrl = sUrl + (sUrl.indexOf("?") > -1 ? "&" : "?") + "tile=" + encodeURIComponent(sTileName);
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(sShareUrl).then(function () {
                        MessageToast.show("Tile link copied to clipboard");
                    }, function () {
                        MessageToast.show("Failed to copy link");
                    });
                } else {
                    MessageToast.show("Clipboard not available");
                }
            }
        },

        handleFullScreen: function () {
            this.bFocusFullScreenButton = true;
            var sNextLayout = this.getOwnerComponent().getModel().getProperty("/actionButtonsInfo/midColumn/fullScreen");
            this.getRouter()._oRoutes.Detail._oConfig.layout = "MidColumnFullScreen";
            this.getRouter().navTo("Detail", { layout: sNextLayout }, true);
        },
        handleExitFullScreen: function () {
            this.bFocusFullScreenButton = true;
            var sNextLayout = this.getOwnerComponent().getModel().getProperty("/actionButtonsInfo/midColumn/exitFullScreen");
            this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
            this.getRouter().navTo("Detail", { layout: sNextLayout }, true);
        },
        handleClose: function () {
            var sNextLayout = this.getOwnerComponent().getModel().getProperty("/actionButtonsInfo/midColumn/closeColumn");
            this.getRouter().navTo("Master", { layout: sNextLayout });
            
            
        }
    });
});