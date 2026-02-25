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
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/core/Item"
], (BaseController, MessageToast, Fragment, JSONModel, Label, Text, Input, DatePicker, CheckBox, ComboBox, VBox, SimpleForm, Item) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Detail", {
        onInit() {
            var oExitButton = this.getView().byId("exitFullScreenBtnMid"),
                oEnterButton = this.getView().byId("enterFullScreenBtnMid");
            this.getLocalDataModel().setProperty("/shareUrl", "Share / Navigate");
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
        },
        onRouteMatched: function () {
            this.setBusyOff();
            // Calculate and set breadcrumb based on selectedNodeData
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            var aTreeList = oLocalDataModel.getProperty("/treeList") || [];
            var aBreadcrumb = [];
            if (oSelectedNode && oSelectedNode.CV_ID) {
                // Traverse up the tree to build the breadcrumb
                var current = oSelectedNode;
                while (current) {
                    aBreadcrumb.unshift({
                        name: current.Name || current.Full_location || current.Full_Location || current.full_location || current.FullLocation || "Node",
                        CV_ID: current.CV_ID
                    });
                    // Find parent node
                    current = aTreeList.find(function (n) { return n.CV_ID === current.Parent_CV_ID; });
                }
            }
            oLocalDataModel.setProperty("/breadcrumb", aBreadcrumb);

            // Update share URL in model for tooltip binding
            if (oSelectedNode && oSelectedNode.CV_ID) {
                oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + oSelectedNode.CV_ID);
            } else {
                oLocalDataModel.setProperty("/shareUrl", "Share / Navigate");
            }
        },
        onBreadcrumbPress: function(oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            var oData = oContext.getObject();
            if (oData && oData.CV_ID) {
                var oRouter = this.getRouter();
                oRouter.navTo("Master", { selectedNode: oData.CV_ID });
            }
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
            self._fieldControlMap = {};
            self.buildFormContent(oFormData, oCategorizedFields);

            self._oFormDialog.open();

            // After form is opened, fetch data and populate form fields
            self._loadFormData(sTableName);
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
                        // Add label with comments as tooltip
                        var oLabel = new sap.m.Label({
                            text: oField.name || oField.fieldName,
                            required: oField.required || false
                        });
                        if (oField.comments) {
                            oLabel.setTooltip(oField.comments);
                            oLabel.addEventDelegate({
                                onAfterRendering: function () {
                                    oLabel.$().attr("title", oField.comments);
                                }
                            });
                        }
                        aFormContent.push(oLabel);

                        // Add input field based on field type
                        var oInput = self.createFieldControl(oField);
                        // Store reference for later data population
                        var sFieldKey = oField.fieldName || oField.name;
                        if (sFieldKey) {
                            self._fieldControlMap[sFieldKey] = oInput;
                        }
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
            // If field has a lookupListId, create a ComboBox and load lookup items
            if (oField.lookupListId) {
                var oComboBox = new sap.m.ComboBox({
                    placeholder: oField.name || oField.fieldName,
                    width: "100%"
                });
                this._loadLookupItems(oComboBox, oField.lookupListId);
                return oComboBox;
            }

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

        _loadLookupItems: function (oComboBox, sLookupListId) {
            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            var fnFetch = function (sResolvedHash) {
                $.ajax({
                    "url": "/bo/Lookup_Item/",
                    "method": "GET",
                    "dataType": "json",
                    "headers": {
                        "X-NEXUS-Filter": JSON.stringify({ "where": [{ "field": "LL_ID", "method": "eq", "value": sLookupListId }] }),
                        "X-NEXUS-Sort": JSON.stringify([{ "field": "Value", "ascending": false }])
                    },
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        var aItems = Array.isArray(response && response.rows) ? response.rows : [];
                        oComboBox.removeAllItems();
                        aItems.forEach(function (oItem) {
                            oComboBox.addItem(new Item({
                                key: oItem.LI_ID || oItem.Value || "",
                                text: oItem.Value || oItem.Name || ""
                            }));
                        });
                    },
                    "error": function () {
                        MessageToast.show("Error loading lookup items");
                    }
                });
            };

            if (sHash) {
                fnFetch(sHash);
                return;
            }

            this.getoHashToken().done(function (oResult) {
                var sFetchedHash = oResult && oResult.hash;
                if (sFetchedHash) {
                    fnFetch(sFetchedHash);
                }
            });
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

        _loadFormData: function (sTableName) {
            var oLocalDataModel = this.getLocalDataModel();
            var sComponentId = oLocalDataModel.getProperty("/sCompoonentID");
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            if (!sComponentId) {
                MessageToast.show("No component selected");
                return;
            }

            var fnFetchData = function (sResolvedHash) {
                self.setBusyOn();
                $.ajax({
                    "url": "/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        self._populateFormFields(response);
                        // Extract Piping_Design_Code and check permissions
                        var oRecord = response;
                        if (Array.isArray(response.rows) && response.rows.length > 0) {
                            oRecord = response.rows[0];
                        } else if (Array.isArray(response) && response.length > 0) {
                            oRecord = response[0];
                        }
                        var sPipingDesignCode = oRecord && oRecord.Piping_Design_Code;
                        if (sPipingDesignCode) {
                            self._checkPermissions(sPipingDesignCode, sResolvedHash); // need to enable
                        } else {
                            // No Piping_Design_Code available, default to read-only
                            self._setFormReadOnly(true);
                            self.setBusyOff();
                        }
                    },
                    "error": function () {
                        MessageToast.show("Error while fetching form data");
                        self.setBusyOff();
                    }
                });
            };

            if (sHash) {
                fnFetchData(sHash);
                return;
            }

            this.getoHashToken().done(function (oResult) {
                var sFetchedHash = oResult && oResult.hash;
                if (!sFetchedHash) {
                    MessageToast.show("Unable to fetch hash token");
                    return;
                }
                fnFetchData(sFetchedHash);
            }).fail(function () {
                MessageToast.show("Unable to fetch hash token");
            });
        },

        _checkPermissions: function (sProductValue, sHash) {
            var self = this;
            $.ajax({
                "url": "/bo/Lookup_Item/" + encodeURIComponent(sProductValue),
                "method": "GET",
                "dataType": "json",
                "data": {
                    "hash": sHash
                },
                "success": function (response) {
                    // Check @permissions at all possible levels in the response
                    var sPermissions = "";
                    if (response) {
                        if (response["@permissions"]) {
                            sPermissions = response["@permissions"];
                        } else if (Array.isArray(response.rows) && response.rows.length > 0 && response.rows[0]["@permissions"]) {
                            sPermissions = response.rows[0]["@permissions"];
                        } else if (Array.isArray(response) && response.length > 0 && response[0]["@permissions"]) {
                            sPermissions = response[0]["@permissions"];
                        } else if (response.data && response.data["@permissions"]) {
                            sPermissions = response.data["@permissions"];
                        }
                    }
                    console.log("Lookup_Item response:", JSON.stringify(response));
                    console.log("Resolved @permissions:", sPermissions);
                    if (sPermissions === "read") {
                        self._setFormReadOnly(true);
                    } else {
                        self._setFormReadOnly(false);
                    }
                    self.setBusyOff();
                },
                "error": function () {
                    // If permission check fails, default to editable
                    self._setFormReadOnly(false);
                    self.setBusyOff();
                }
            });
        },

        _setFormReadOnly: function (bReadOnly) {
            return; // Temporarily disable read-only logic until permissions are properly set up
            // Set all form field controls to read-only / non-editable
            if (this._fieldControlMap) {
                Object.keys(this._fieldControlMap).forEach(function (sKey) {
                    var oControl = this._fieldControlMap[sKey];
                    if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.DatePicker") || oControl.isA("sap.m.ComboBox")) {
                        oControl.setEditable(!bReadOnly);
                    } else if (oControl.isA("sap.m.CheckBox")) {
                        oControl.setEnabled(!bReadOnly);
                    }
                }.bind(this));
            }

            // Show or hide the Save button
            if (this._oFormDialog) {
                var oSaveButton = this._oFormDialog.getBeginButton();
                if (oSaveButton) {
                    oSaveButton.setVisible(!bReadOnly);
                }
            }
        },

        _populateFormFields: function (oData) {
            if (!oData || !this._fieldControlMap) {
                return;
            }

            // The response may have rows array or be a direct object
            var oRecord = oData;
            if (Array.isArray(oData.rows) && oData.rows.length > 0) {
                oRecord = oData.rows[0];
            } else if (Array.isArray(oData) && oData.length > 0) {
                oRecord = oData[0];
            }

            var self = this;
            Object.keys(this._fieldControlMap).forEach(function (sFieldKey) {
                var oControl = self._fieldControlMap[sFieldKey];
                var vValue = oRecord[sFieldKey];

                if (vValue === undefined || vValue === null) {
                    return;
                }

                if (oControl.isA("sap.m.Input")) {
                    oControl.setValue(String(vValue));
                } else if (oControl.isA("sap.m.DatePicker")) {
                    oControl.setValue(String(vValue));
                } else if (oControl.isA("sap.m.CheckBox")) {
                    oControl.setSelected(!!vValue);
                } else if (oControl.isA("sap.m.ComboBox")) {
                    // Try to match by key first, then fall back to value
                    var aItems = oControl.getItems();
                    var bFound = aItems.some(function (oItem) {
                        return oItem.getKey() === String(vValue);
                    });
                    if (bFound) {
                        oControl.setSelectedKey(String(vValue));
                    } else {
                        oControl.setValue(String(vValue));
                    }
                }
            });
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