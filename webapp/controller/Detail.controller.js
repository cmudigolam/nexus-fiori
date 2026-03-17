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
    "sap/m/Select",
    "sap/m/VBox",
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/core/Item",
    "sap/m/MessageBox"
], (BaseController, MessageToast, Fragment, JSONModel, Label, Text, Input, DatePicker, CheckBox, Select, VBox, SimpleForm, Item, MessageBox) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Detail", {
        onInit() {
            var oExitButton = this.getView().byId("exitFullScreenBtnMid"),
                oEnterButton = this.getView().byId("enterFullScreenBtnMid");
            this.getLocalDataModel().setProperty("/shareUrl", this.getResourceBundle().getText("tooltipShareNavigate"));
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
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            
            // If no asset is selected, select the first one by default
            if (!oSelectedNode) {
                var aNodeInfoArray = oLocalDataModel.getProperty("/nodeInfoArray");
                console.log("Detail onRouteMatched - selectedNodeData is null");
                console.log("nodeInfoArray length:", aNodeInfoArray ? aNodeInfoArray.length : 0);
                
                if (aNodeInfoArray && aNodeInfoArray.length > 0) {
                    oSelectedNode = aNodeInfoArray[0];
                    oLocalDataModel.setProperty("/selectedNodeData", oSelectedNode);
                    console.log("First asset auto-selected:", oSelectedNode);
                    
                    // Update breadcrumb for the first asset
                    this.updateBreadcrumb();
                    
                    // Fetch detail tiles for the first asset
                    if (oSelectedNode.CT_ID) {
                        var sHash = oLocalDataModel.getProperty("/HashToken");
                        console.log("Fetching tiles for first asset - CT_ID:", oSelectedNode.CT_ID, "Component_ID:", oSelectedNode.Component_ID);
                        this.fetchDetailTiles(oSelectedNode.CT_ID, oSelectedNode.Component_ID, sHash);
                    }
                } else {
                    console.log("No nodeInfoArray available yet");
                    // Set up a listener to auto-select when data becomes available
                    oLocalDataModel.attachPropertyChange(function (oEvent) {
                        if (oEvent.getParameter("path") === "/nodeInfoArray") {
                            var aNewArray = oEvent.getParameter("value");
                            if (aNewArray && aNewArray.length > 0) {
                                var oFirstNode = aNewArray[0];
                                var oCurrentSelected = oLocalDataModel.getProperty("/selectedNodeData");
                                if (!oCurrentSelected) {
                                    oLocalDataModel.setProperty("/selectedNodeData", oFirstNode);
                                    console.log("Asset auto-selected after data loaded:", oFirstNode);
                                    this.updateBreadcrumb();
                                    if (oFirstNode.CT_ID) {
                                        var sHash = oLocalDataModel.getProperty("/HashToken");
                                        this.fetchDetailTiles(oFirstNode.CT_ID, oFirstNode.Component_ID, sHash);
                                    }
                                }
                                // Remove this listener after it fires once
                                oLocalDataModel.detachPropertyChange(arguments.callee);
                            }
                        }
                    }.bind(this));
                }
            }
            
            // Update share URL in model for tooltip binding
            if (oSelectedNode && oSelectedNode.VN_ID) {
                oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + oSelectedNode.VN_ID);
            } else {
                oLocalDataModel.setProperty("/shareUrl", this.getResourceBundle().getText("tooltipShareNavigate"));
            }
        },

        updateBreadcrumb: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            var aBreadcrumb = [];
            var segments = [];
            if (oSelectedNode && (oSelectedNode.Full_Location || oSelectedNode.Full_location || oSelectedNode.full_location || oSelectedNode.FullLocation)) {
                var fullLocation = oSelectedNode.Full_Location || oSelectedNode.Full_location || oSelectedNode.full_location || oSelectedNode.FullLocation || "";
                var segments = fullLocation ? fullLocation.split(" / ") : [];
                segments.forEach(function(segment) {
                    aBreadcrumb.push({
                        name: segment
                    });
                });
            }
            oLocalDataModel.setProperty("/breadcrumb", aBreadcrumb);
        },

        onBreadcrumbPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            var oData = oContext.getObject();
            var oLocalDataModel = this.getLocalDataModel();
            var nodeInfoArr = oLocalDataModel.getProperty("/nodeInfoArray") || [];
            var oBreadcrumbs = oLocalDataModel.getProperty("/breadcrumb") || [];
            // Find the index of the clicked breadcrumb
            var idx = oBreadcrumbs.findIndex(function(b) { return b.name === oData.name; });
            // Reconstruct the full_location up to this breadcrumb
            var pathSoFar = oBreadcrumbs.slice(0, idx + 1).map(function(b) { return b.name; }).join(" / ");
            // Find the node by full_location
            var oNode = nodeInfoArr.find(function(n) { 
                var fullLocation = n.Full_Location || n.Full_location || n.full_location || n.FullLocation || "";
                return fullLocation === pathSoFar; 
            });
            if (!oNode || !oNode.CV_ID || !oNode.CT_ID) {
                return;
            }
            oLocalDataModel.setProperty("/selectedNodeData", oNode);
            var sCtId = oNode.CT_ID;

            this.fetchDetailTiles(sCtId, oNode.Component_ID, oLocalDataModel.getProperty("/HashToken"));

            // First service call: get TD_IDs by CT_ID
            // $.ajax({
            //     "url": "/bo/Info_Def/",
            //     "method": "GET",
            //     "dataType": "json",
            //     "headers": {
            //         "X-NEXUS-Filter": '{"where":[{"field":"CT_ID","method":"eq","value":"' + sCtId + '"}]}'
            //     },
            //     "data": {
            //         "hash": this.getLocalDataModel().getProperty("/HashToken")
            //     },
            //     "success": function (response) {
            //         var aRows = Array.isArray(response && response.rows) ? response.rows : [];
            //         var aTdIds = aRows.map(function (row) {
            //             return row.TD_ID;
            //         }).filter(function (id) {
            //             return id !== undefined && id !== null;
            //         });
            //         if (aTdIds.length === 0) {
            //             oLocalDataModel.setProperty("/detailTiles", []);
            //             oLocalDataModel.setProperty("/detailTileGroups", []);
            //             this.setBusyOff();
            //             return;
            //         }
            //         // Second service call: get table definitions by TD_IDs
            //         $.ajax({
            //             "url": "/bo/Table_Def/",
            //             "method": "GET",
            //             "dataType": "json",
            //             "headers": {
            //                 "X-NEXUS-Filter": '{"where":[{"field":"TD_ID","method":"in","items":[' + aTdIds.join(",") + ']}]}'
            //             },
            //             "data": {
            //                 "hash": this.getLocalDataModel().getProperty("/HashToken")
            //             },
            //             "success": function (response2) {
            //                 var iconList = [
            //                     "sap-icon://home",
            //                     "sap-icon://account",
            //                     "sap-icon://employee",
            //                     "sap-icon://settings",
            //                     "sap-icon://document",
            //                     "sap-icon://calendar",
            //                     "sap-icon://customer",
            //                     "sap-icon://task",
            //                     "sap-icon://attachment",
            //                     "sap-icon://search",
            //                     "sap-icon://activities",
            //                     "sap-icon://activity-items"
            //                 ];
            //                 var tdIdToIcon = {};
            //                 aTdIds.forEach(function (tdId, idx) {
            //                     tdIdToIcon[tdId] = iconList[idx] || "sap-icon://hint";
            //                 });
            //                 var aTiles = (Array.isArray(response2 && response2.rows) ? response2.rows : []).map(function (tile) {
            //                     tile.icon = tdIdToIcon[tile.TD_ID] || "sap-icon://hint";
            //                     return tile;
            //                 });
            //                 var oCategoryMap = {};
            //                 aTiles.forEach(function (oTile) {
            //                     var sCategory = oTile.Category || oTile.category || "Uncategorized";
            //                     if (!oCategoryMap[sCategory]) {
            //                         oCategoryMap[sCategory] = [];
            //                     }
            //                     oCategoryMap[sCategory].push(oTile);
            //                 });
            //                 var aTileGroups = Object.keys(oCategoryMap).sort().map(function (sCategory) {
            //                     return {
            //                         Category: sCategory,
            //                         tiles: oCategoryMap[sCategory]
            //                     };
            //                 });
            //                 oLocalDataModel.setProperty("/detailTiles", aTiles);
            //                 oLocalDataModel.setProperty("/detailTileGroups", aTileGroups);
            //                 this.setBusyOff();
            //             }.bind(this),
            //             "error": function () {
            //                 MessageToast.show("Error while fetching table definitions");
            //                 this.setBusyOff();
            //             }.bind(this)
            //         });
            //     }.bind(this),
            //     "error": function () {
            //         MessageToast.show("Error while fetching info definitions");
            //         this.setBusyOff();
            //     }.bind(this)
            // });
        },
        onTilePress: function (oEvent) {
            var self = this;
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            if (!oContext) {
                MessageToast.show(this.getResourceBundle().getText("msgNoTileContext"));
                return;
            }

            var sTableName = oContext.getProperty("Table_Name");
            if (!sTableName) {
                MessageToast.show(this.getResourceBundle().getText("msgTableNameMissing"));
                return;
            }

            // Get the tile title/name for the dialog header
            var sTileTitle = oContext.getProperty("Name") || sTableName;

            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");
            this.setBusyOn();
            var fnCallTableApi = function (sResolvedHash) {
                this.setBusyOn();
                $.ajax({
                    "url": self.isRunninglocally()+ "/bo/" + encodeURIComponent(sTableName),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        oLocalDataModel.setProperty("/selectedTableName", sTableName);
                        oLocalDataModel.setProperty("/selectedTableData", response);
                        this.openDynamicFormDialog(sTableName, response, sTileTitle);
                        this.setBusyOff();
                    }.bind(this),
                    "error": function () {
                        MessageToast.show(this.getResourceBundle().getText("msgErrorFetchingTableData"));
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
                    MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
                    return;
                }
                fnCallTableApi(sFetchedHash);
            }).fail(function () {
                MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
            });
        },
        onSAPDATATilePress: function (oEvent) {
            var self = this;
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            var sHash = oLocalDataModel.getProperty("/HashToken");

            if (!oSelectedNode || !oSelectedNode.Component_ID) {
                MessageToast.show(this.getResourceBundle().getText("msgNoAssetSelected"));
                return;
            }

            var sComponentId = oSelectedNode.Component_ID;

            // Fetch external references for this component
            var fnFetchExternalReferences = function (sResolvedHash) {
                self.setBusyOn();
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/External_References/" + encodeURIComponent(sComponentId),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        console.log("External_References Response:", response);
                        
                        // Extract data from response
                        var oRecord = response;
                        if (Array.isArray(response.rows) && response.rows.length > 0) {
                            oRecord = response.rows[0];
                        } else if (Array.isArray(response) && response.length > 0) {
                            oRecord = response[0];
                        }

                        var sFunctionalLocation = oRecord.Functional_Location || "";
                        var sExternalReferenceId = oRecord.External_Reference_ID || "";
                        var sEquipmentId = oRecord.EquipementID || "";

                        console.log("Extracted values:");
                        console.log("  Functional_Location:", sFunctionalLocation);
                        console.log("  External_Reference_ID:", sExternalReferenceId);
                        console.log("  EquipementID:", sEquipmentId);

                        // Navigate to SAP with the extracted values
                        var sUrl = "https://pipl-sapa23.pilogcloud.com:8100/sap/bc/ui2/flp?sap-client=100&sap-language=EN#MaintenanceObject-displayFactSheet";
                        if (sEquipmentId) {
                            sUrl += "&/C_ObjPgTechnicalObject(TechObjIsEquipOrFuncnlLoc='EAMS_EQUI',TechnicalObject=%27" + encodeURIComponent(sExternalReferenceId) + "%27)";
                        } else if (sFunctionalLocation) {
                            sUrl += "&/C_ObjPgTechnicalObject(TechObjIsEquipOrFuncnlLoc='EAMS_FL',TechnicalObject=%27" + encodeURIComponent(sExternalReferenceId) + "%27)";
                        }
                        
                        window.open(sUrl, "_blank");
                        self.setBusyOff();
                    },
                    "error": function () {
                        MessageToast.show(self.getResourceBundle().getText("msgErrorFetchingExternalReferences"));
                        self.setBusyOff();
                    }
                });
            };

            if (sHash) {
                fnFetchExternalReferences(sHash);
                return;
            }

            // If no hash available, fetch it first
            this.getoHashToken().done(function (oResult) {
                var sFetchedHash = oResult && oResult.hash;
                if (!sFetchedHash) {
                    MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
                    return;
                }
                fnFetchExternalReferences(sFetchedHash);
            }).fail(function () {
                MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
            });
        },

        openDynamicFormDialog: function (sTableName, oFormData, sTileTitle) {

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
                MessageToast.show(this.getResourceBundle().getText("msgNoFieldsAvailable"));
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
            // Create dialog content model with tile title as dialog title
            var oDialogModel = {
                title: sTileTitle || sTableName,
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
            self._pendingComboBoxValues = {};
            self._pendingLookupCount = 0;
            self._formDataTableName = sTableName;
            self.buildFormContent(oFormData, oCategorizedFields);

            // Set busy indicator to show immediately when dialog opens
            self._oFormDialog.setBusyIndicatorDelay(0);
            self._oFormDialog.setBusy(true);
            
            self._oFormDialog.open();

            // After form is opened, check if there are pending lookups
            // If no lookups, load form data immediately
            // Otherwise, it will be called after all lookups complete
            if (self._pendingLookupCount === 0) {
                self._loadFormData(sTableName);
            }
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
                    // Sort fields by formOrder before processing
                    var aSortedFields = oCategorizedFields[oCategory.name].slice().sort(function (a, b) {
                        var aOrder = a.formOrder !== undefined ? parseInt(a.formOrder) : 999999;
                        var bOrder = b.formOrder !== undefined ? parseInt(b.formOrder) : 999999;
                        return aOrder - bOrder;
                    });
                    
                    aSortedFields.forEach(function (oField) {
                        // Determine visibility based on formVisible property from API metadata
                        var bVisible = oField.formVisible !== false;

                        // Add label with comments as tooltip
                        var oLabel = new sap.m.Label({
                            text: oField.name || oField.fieldName,
                            required: oField.required || false,
                            visible: bVisible
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
                        oInput.setVisible(bVisible);
                        // Store reference for later data population
                        var sFieldKey = oField.fieldName || oField.name;
                        console.log("Creating field - fieldName:", oField.fieldName, "name:", oField.name, "using key:", sFieldKey, "lookupListId:", oField.lookupListId, "fieldTypeId:", oField.fieldTypeId, "formOrder:", oField.formOrder);
                        if (sFieldKey) {
                            self._fieldControlMap[sFieldKey] = oInput;
                        }
                        aFormContent.push(oInput);
                    });
                } else {
                    // No fields for this category
                    aFormContent.push(
                        new sap.m.Text({
                            text: self.getResourceBundle().getText("msgNoFieldsForCategory"),
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
                    height: "100%",
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
            // If field has a lookupListId, create a Select and load lookup items
            if (oField.lookupListId) {
                this._pendingLookupCount++;
                var oSelect = new sap.m.Select({
                    //placeholder: oField.name || oField.fieldName,
                    width: "100%"
                });
                this._loadLookupItems(oSelect, oField.lookupListId);
                return oSelect;
            }

            // Create appropriate control based on field type
            switch (oField.fieldTypeId) {
                case 9: // Date field
                    return new sap.m.DatePicker({
                        //placeholder: oField.name || oField.fieldName,
                        valueFormat: "yyyy-MM-dd"
                    });
                case 5: // Boolean field
                    return new sap.m.CheckBox({
                        text: ""
                    });
                case 6: // Numeric field
                    return new sap.m.Input({
                        type: "Number",
                        //placeholder: oField.name || oField.fieldName
                    });
                case 37: // Lookup/Dropdown field
                    this._pendingLookupCount++;
                    var oSelect = new sap.m.Select({
                        //placeholder: oField.name || oField.fieldName
                    });
                    // Note: For fieldTypeId 37, lookupListId should be set separately
                    return oSelect;
                case 38: // Sub-table
                    return new sap.m.Input({
                        //placeholder: oField.name || oField.fieldName,
                        enabled: false
                    });
                default: // Text field
                    return new sap.m.Input({
                        type: "Text",
                        //placeholder: oField.name || oField.fieldName
                    });
            }
        },

        _loadLookupItems: function (oSelect, sLookupListId) {
            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            var fnFetch = function (sResolvedHash) {
                $.ajax({
                    "url": self.isRunninglocally()+ "/bo/Lookup_Item/",
                    "method": "GET",
                    "dataType": "json",
                    "headers": {
                        "X-NEXUS-Filter": JSON.stringify({ "where": [{ "field": "LL_ID", "method": "eq", "value": sLookupListId }] }),
                        "X-NEXUS-Sort": JSON.stringify([{ "field": "Value", "ascending": true }])
                    },
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        var aItems = Array.isArray(response && response.rows) ? response.rows : [];
                        console.log("Lookup_Item Response for LL_ID " + sLookupListId + ":", aItems);
                        oSelect.removeAllItems();
                        aItems.forEach(function (oItem) {
                            // Use LI_ID as the key (internal identifier stored in database)
                            // Use Value as the display text (what user sees)
                            var sKey = String(oItem.LI_ID || oItem.Value || "");
                            var sText = String(oItem.Value || oItem.Name || oItem.Description || "");
                            console.log("Adding lookup item - LI_ID (Key):", sKey, "Value (Text):", sText, "Full item:", oItem);
                            oSelect.addItem(new Item({
                                key: sKey,
                                text: sText
                            }));
                        });
                        
                        // After items are loaded, apply any pending value selection
                        console.log("Lookup items loaded. Checking for pending values...");
                        self._applyPendingComboBoxValues();
                        
                        // Decrement pending lookup count
                        self._pendingLookupCount--;
                        console.log("Lookup completed. Pending lookups remaining:", self._pendingLookupCount);
                        
                        // If all lookups are done, load form data
                        if (self._pendingLookupCount === 0 && self._formDataTableName) {
                            console.log("All lookups completed. Loading form data...");
                            self._loadFormData(self._formDataTableName);
                        }
                    },
                    "error": function () {
                        MessageToast.show(self.getResourceBundle().getText("msgErrorLoadingLookupItems"));
                        
                        // Decrement pending lookup count even on error
                        self._pendingLookupCount--;
                        console.log("Lookup failed. Pending lookups remaining:", self._pendingLookupCount);
                        
                        // If all lookups are done (or failed), load form data
                        if (self._pendingLookupCount === 0 && self._formDataTableName) {
                            console.log("All lookups completed (some failed). Loading form data...");
                            self._loadFormData(self._formDataTableName);
                        }
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
                MessageToast.show(this.getResourceBundle().getText("msgNoComponentSelected"));
                // Turn off busy indicator if no component is selected
                if (this._oFormDialog) {
                    this._oFormDialog.setBusy(false);
                }
                return;
            }

            var fnFetchData = function (sResolvedHash) {
                self.setBusyOn();
                $.ajax({
                    "url": self.isRunninglocally()+ "/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        self._populateFormFields(response);
                        // Extract Component_ID and record for validation
                        var oRecord = response;
                        if (Array.isArray(response.rows) && response.rows.length > 0) {
                            oRecord = response.rows[0];
                        } else if (Array.isArray(response) && response.length > 0) {
                            oRecord = response[0];
                        }
                        var sComponentId = oRecord && oRecord.Component_ID;
                        if (sComponentId) {
                            // Make validation POST call to check field visibility
                            self._validateFieldVisibility(sComponentId, oRecord, sResolvedHash,sTableName);
                        } else {
                            self.setBusyOff();
                        }
                    },
                    "error": function () {
                        MessageToast.show(self.getResourceBundle().getText("msgErrorFetchingFormData"));
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
                    MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
                    // Turn off busy indicator if hash token cannot be fetched
                    if (self._oFormDialog) {
                        self._oFormDialog.setBusy(false);
                    }
                    return;
                }
                fnFetchData(sFetchedHash);
            }).fail(function () {
                MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
                // Turn off busy indicator on hash token fetch failure
                if (self._oFormDialog) {
                    self._oFormDialog.setBusy(false);
                }
            });
        },

        _validateFieldVisibility: function (sComponentId, oRecord, sHash,sTableName) {
            var self = this;
            // Show busy indicator on dialog
            if (this._oFormDialog) {
                this._oFormDialog.setBusy(true);
            }
            $.ajax({
                "url": self.isRunninglocally()+ "/bo/" + encodeURIComponent(sTableName) + "/validate/" + encodeURIComponent(sComponentId) + "?hash=" + encodeURIComponent(sHash),
                "method": "POST",
                "contentType": "application/json",
                "dataType": "json",
                "data": JSON.stringify(oRecord),
                "success": function (response) {
                    // Update field visibility based on validation response
                    self._updateFieldVisibilityFromValidation(response);
                    // Hide busy indicator on dialog
                    if (self._oFormDialog) {
                        self._oFormDialog.setBusy(false);
                    }
                    // Hide global busy indicator
                    self.setBusyOff();
                },
                "error": function () {
                    // If validation fails, hide busy indicator
                    if (self._oFormDialog) {
                        self._oFormDialog.setBusy(false);
                    }
                    // Hide global busy indicator
                    self.setBusyOff();
                }
            });
        },

        _updateFieldVisibilityFromValidation: function (oValidationResponse) {
            if (!oValidationResponse || !this._fieldControlMap) {
                return;
            }

            var oFormModel = this._oFormDialog && this._oFormDialog.getModel("FormData");
            if (!oFormModel) {
                return;
            }

            var oFormData = oFormModel.getProperty("/formData");
            if (!oFormData || !oFormData.fields) {
                return;
            }

            // Check if updateStates is available in the response
            var oUpdateStates = oValidationResponse.updateStates;
            var bHasUpdateStates = oUpdateStates && typeof oUpdateStates === "object";
            console.log("UpdateStates structure:", oUpdateStates);
            console.log("UpdateStates is array?", Array.isArray(oUpdateStates));

            var self = this;
            var iVisibleFieldCount = 0;
            
            oFormData.fields.forEach(function (oField) {
                var sFieldKey = oField.fieldName || oField.name;
                var oControl = self._fieldControlMap[sFieldKey];

                if (!oControl) {
                    return;
                }

                // Rule 1: If formVisible is false from metadata, field is HIDDEN
                if (oField.formVisible === false) {
                    console.log("Field", sFieldKey, "-> formVisible=false, HIDDEN");
                    oControl.setVisible(false);
                    return;
                }

                // Rule 2: formVisible is true or not specified, check updateStates
                var bFieldVisible = true; // default visibility
                
                if (bHasUpdateStates) {
                    var oFieldUpdateState;
                    
                    // Find field in updateStates (handle both array and object)
                    if (Array.isArray(oUpdateStates)) {
                        oFieldUpdateState = oUpdateStates.find(function (oItem) {
                            return oItem.fieldName === sFieldKey || oItem.name === sFieldKey || oItem.id === sFieldKey;
                        });
                    } else {
                        oFieldUpdateState = oUpdateStates[sFieldKey] || oUpdateStates[String(sFieldKey)];
                    }
                    
                    // If field found in updateStates, check its visible property
                    if (oFieldUpdateState !== undefined && oFieldUpdateState !== null) {
                        if (oFieldUpdateState.visible !== undefined) {
                            // visible property exists -> use its value
                            bFieldVisible = oFieldUpdateState.visible === true;
                            console.log("Field", sFieldKey, "-> found in updateStates, visible=" + oFieldUpdateState.visible + ", VISIBILITY=" + bFieldVisible);
                        } else {
                            // visible property doesn't exist -> default to visible
                            bFieldVisible = true;
                            console.log("Field", sFieldKey, "-> found in updateStates but no visible property, default VISIBLE");
                        }
                    } else {
                        // Field NOT found in updateStates -> default to visible
                        bFieldVisible = true;
                        console.log("Field", sFieldKey, "-> NOT found in updateStates, default VISIBLE");
                    }
                } else {
                    // No updateStates in response -> default to visible
                    bFieldVisible = true;
                    console.log("Field", sFieldKey, "-> no updateStates, default VISIBLE");
                }
                
                oControl.setVisible(bFieldVisible);
                if (bFieldVisible) {
                    iVisibleFieldCount++;
                }
            });

            // If no fields are visible, show message and hide save button
            if (iVisibleFieldCount === 0) {
                MessageToast.show(this.getResourceBundle().getText("msgNoFieldsVisible") || "Fields are not visible");
                // Hide the save button
                if (this._oFormDialog) {
                    var oSaveButton = this._oFormDialog.getBeginButton();
                    if (oSaveButton) {
                        oSaveButton.setVisible(false);
                    }
                }
            }
        },

        _checkPermissions: function (sProductValue, sHash) {
            var self = this;
            $.ajax({
                "url": self.isRunninglocally()+ "/bo/Lookup_Item/" + encodeURIComponent(sProductValue),
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
                    if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.DatePicker") || oControl.isA("sap.m.Select")) {
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

            console.log("=== POPULATE FORM FIELDS ===");
            console.log("Record data:", JSON.stringify(oRecord, null, 2));
            console.log("Field Control Map has keys:", Object.keys(this._fieldControlMap));
            console.log("============================");

            // Initialize pending ComboBox values
            if (!this._pendingComboBoxValues) {
                this._pendingComboBoxValues = {};
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
                } else if (oControl.isA("sap.m.Select")) {
                    var sValueStr = String(vValue).trim();
                    console.log("=== POPULATE Select ===");
                    console.log("Field Key:", sFieldKey);
                    console.log("Raw value from record:", vValue);
                    console.log("Normalized value:", sValueStr);
                    
                    // Store this value as pending - it will be applied after items load
                    self._pendingComboBoxValues[sFieldKey] = {
                        control: oControl,
                        value: sValueStr
                    };
                    
                    // Get all items in the select
                    var aItems = oControl.getItems();
                    console.log("Select has", aItems.length, "items currently");
                    
                    if (aItems && aItems.length > 0) {
                        // Items already loaded, apply immediately
                        console.log("Items available, applying value immediately");
                        self._applyComboBoxValue(oControl, sFieldKey, sValueStr);
                    } else {
                        // Items not loaded yet - they will be applied when _applyPendingComboBoxValues is called
                        console.log("Items not loaded yet, storing as pending");
                    }
                    console.log("==========================");
                }
            });
        },

        onFormDialogClose: function () {
            if (this._oFormDialog) {
                this._oFormDialog.setBusy(false);
                this._clearFieldValidationErrors();
                this._oFormDialog.close();
            }
        },

        _showFieldValidationErrors: function (aInvalidFields) {
            if (!this._fieldControlMap || !aInvalidFields) {
                return;
            }
            aInvalidFields.forEach(function (oInvalid) {
                var oControl = this._fieldControlMap[oInvalid.field];
                if (oControl) {
                    if (oControl.setValueState) {
                        oControl.setValueState("Error");
                        oControl.setValueStateText(oInvalid.message || this.getResourceBundle().getText("msgFieldRequired"));
                    }
                    // Add red border styling for better visibility
                    if (oControl.addStyleClass) {
                        oControl.addStyleClass("mandatoryFieldError");
                    }
                }
            }.bind(this));
        },

        _clearFieldValidationErrors: function () {
            if (!this._fieldControlMap) {
                return;
            }
            var oMap = this._fieldControlMap;
            Object.keys(oMap).forEach(function (sKey) {
                var oControl = oMap[sKey];
                if (oControl && oControl.setValueState) {
                    oControl.setValueState("None");
                    oControl.setValueStateText("");
                }
                // Remove error styling
                if (oControl.removeStyleClass) {
                    oControl.removeStyleClass("mandatoryFieldError");
                }
            });
        },

        _validateMandatoryFields: function () {
            var aValidationErrors = [];
            var oFormData = this._oFormDialog.getModel("FormData").getProperty("/formData");

            if (!oFormData || !oFormData.fields || !this._fieldControlMap) {
                return aValidationErrors;
            }

            var self = this;
            oFormData.fields.forEach(function (oField) {
                if (oField.required) {
                    var sFieldKey = oField.fieldName || oField.name;
                    var oControl = self._fieldControlMap[sFieldKey];

                    if (oControl) {
                        var bIsValid = false;

                        if (oControl.isA("sap.m.Input")) {
                            bIsValid = oControl.getValue() && oControl.getValue().trim() !== "";
                        } else if (oControl.isA("sap.m.DatePicker")) {
                            bIsValid = oControl.getDateValue() !== null;
                        } else if (oControl.isA("sap.m.CheckBox")) {
                            // Checkboxes are typically not mandatory in the same way
                            bIsValid = true;
                        } else if (oControl.isA("sap.m.Select")) {
                            bIsValid = (oControl.getSelectedKey() || oControl.getValue()) && 
                                      (oControl.getSelectedKey() || oControl.getValue()).trim() !== "";
                        }

                        if (!bIsValid) {
                            aValidationErrors.push({
                                field: sFieldKey,
                                message: self.getResourceBundle().getText("msgFieldRequired")
                            });
                        }
                    }
                }
            });

            return aValidationErrors;
        },

        _applyComboBoxValue: function (oSelect, sFieldKey, sValue) {
            var aItems = oSelect.getItems();
            console.log("_applyComboBoxValue for field:", sFieldKey, "value:", sValue);
            
            if (!aItems || aItems.length === 0) {
                console.log("No items available in Select");
                return;
            }
            
            // Normalize the value for comparison
            var sNormalizedValue = String(sValue).trim();
            
            // Log all available keys and texts
            var aAvailableKeys = [];
            aItems.forEach(function(oItem, idx) {
                aAvailableKeys.push({
                    key: oItem.getKey(),
                    text: oItem.getText()
                });
            });
            console.log("Available items:", aAvailableKeys);
            console.log("Looking for value:", sNormalizedValue);
            
            // Priority 1: Try to match by display text (Value field from lookup) since that's what gets stored
            var matchedKey = null;
            for (var i = 0; i < aItems.length; i++) {
                var sItemText = String(aItems[i].getText()).trim();
                
                // Try text match first (this is what the database stores)
                if (sItemText === sNormalizedValue) {
                    matchedKey = aItems[i].getKey();
                    console.log("✓ Found matching TEXT (Value), setting selected key:", matchedKey, "text:", sItemText);
                    break;
                }
            }
            
            // Priority 2: If no text match, try key match (LI_ID)
            if (matchedKey === null) {
                for (var i = 0; i < aItems.length; i++) {
                    var sItemKey = String(aItems[i].getKey()).trim();
                    
                    // Try key match (including numeric comparison)
                    if (sItemKey === sNormalizedValue || parseInt(sItemKey) === parseInt(sNormalizedValue)) {
                        matchedKey = aItems[i].getKey();
                        console.log("✓ Found matching KEY (LI_ID), setting selected key:", matchedKey);
                        break;
                    }
                }
            }
            
            if (matchedKey !== null) {
                oSelect.setSelectedKey(matchedKey);
            } else {
                console.log("✗ No matching value found for:", sNormalizedValue);
                console.log("Available items:", aAvailableKeys);
            }
        },

        _applyPendingComboBoxValues: function () {
            console.log("=== APPLYING PENDING ComboBox VALUES ===");
            if (!this._pendingComboBoxValues || Object.keys(this._pendingComboBoxValues).length === 0) {
                console.log("No pending values to apply");
                console.log("=======================================");
                return;
            }
            
            var self = this;
            Object.keys(this._pendingComboBoxValues).forEach(function (sFieldKey) {
                var oPending = self._pendingComboBoxValues[sFieldKey];
                console.log("Applying pending value for field:", sFieldKey, "value:", oPending.value);
                self._applyComboBoxValue(oPending.control, sFieldKey, oPending.value);
            });
            
            // Clear pending values after applying
            this._pendingComboBoxValues = {};
            console.log("=======================================");
        },

        onFormSave: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var sTableName = oLocalDataModel.getProperty("/selectedTableName");
            var sComponentId = oLocalDataModel.getProperty("/sCompoonentID");
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            if (!sTableName || !sComponentId) {
                MessageToast.show(this.getResourceBundle().getText("msgMissingTableOrComponent"));
                return;
            }

            // Clear previous validation errors
            self._clearFieldValidationErrors();

            // Perform mandatory field validation
            var aValidationErrors = self._validateMandatoryFields();
            if (aValidationErrors.length > 0) {
                self._showFieldValidationErrors(aValidationErrors);
                MessageToast.show(self.getResourceBundle().getText("msgFieldsRequireAttention", [aValidationErrors.length]));
                return;
            }

            // Collect form field values from _fieldControlMap (only non-empty values)
            var oPayload = {};
            if (this._fieldControlMap) {
                Object.keys(this._fieldControlMap).forEach(function (sFieldKey) {
                    var oControl = self._fieldControlMap[sFieldKey];
                    var vValue;
                    if (oControl.isA("sap.m.Input")) {
                        vValue = oControl.getValue();
                        if (vValue !== "" && vValue !== undefined) {
                            oPayload[sFieldKey] = vValue;
                        }
                    } else if (oControl.isA("sap.m.DatePicker")) {
                        // Use getDateValue() to get the JS Date, then format to yyyy-MM-dd
                        var oDate = oControl.getDateValue();
                        if (oDate) {
                            var sYear = oDate.getFullYear();
                            var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
                            var sDay = String(oDate.getDate()).padStart(2, "0");
                            oPayload[sFieldKey] = sYear + "-" + sMonth + "-" + sDay;
                        }
                    } else if (oControl.isA("sap.m.CheckBox")) {
                        oPayload[sFieldKey] = oControl.getSelected();
                    } else if (oControl.isA("sap.m.Select")) {
                        var sSelectedKey = oControl.getSelectedKey();
                        var oSelectedItem = oControl.getSelectedItem();
                        var sSelectedText = oSelectedItem ? oSelectedItem.getText() : "";
                        
                        console.log("=== Select Extract ===");
                        console.log("Field Key:", sFieldKey);
                        console.log("Selected Key (LI_ID):", sSelectedKey);
                        console.log("Selected Text (Value):", sSelectedText);
                        console.log("Selected Item:", oSelectedItem);
                        
                        // Post the selected text/value (not the LI_ID) - this is what the database expects
                        if (sSelectedText !== "" && sSelectedText !== undefined) {
                            oPayload[sFieldKey] = sSelectedText;
                            console.log("✓ Posting field:", sFieldKey, "= value:", sSelectedText);
                        } else if (sSelectedKey !== "" && sSelectedKey !== undefined) {
                            oPayload[sFieldKey] = sSelectedKey;
                            console.log("✓ Posting field:", sFieldKey, "= key value:", sSelectedKey);
                        } else {
                            console.log("✗ No value selected for field:", sFieldKey);
                        }
                        console.log("======================");
                    }
                });
            }
            self.setBusyOn();
            var fnPostData = function (sResolvedHash) {
                self.setBusyOn();
                console.log("=== FORM SAVE DEBUG ===");
                console.log("Table:", sTableName);
                console.log("Component ID:", sComponentId);
                console.log("Field Control Map Keys:", Object.keys(self._fieldControlMap));
                console.log("Payload to post:", JSON.stringify(oPayload, null, 2));
                console.log("Payload keys:", Object.keys(oPayload));
                console.log("========================");
                $.ajax({
                    "url": self.isRunninglocally()+ "/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId) + "?hash=" + encodeURIComponent(sResolvedHash),
                    "method": "POST",
                    "contentType": "application/json",
                    "dataType": "json",
                    "data": JSON.stringify(oPayload),
                    "success": function () {
                        MessageBox.success(self.getResourceBundle().getText("msgFormSaveSuccess"), {
                            onClose: function () {
                                if (self._oFormDialog) {
                                    self._oFormDialog.close();
                                }
                            }
                        });
                        self.setBusyOff();
                        if (self._oFormDialog) {
                            self._oFormDialog.close();
                        }
                    },
                    "error": function (jqXHR) {
                        var sMsg = self.getResourceBundle().getText("msgErrorSavingFormData");
                        console.error("=== FORM SAVE ERROR ===");
                        console.error("HTTP Status:", jqXHR.status);
                        console.error("Payload sent:", JSON.stringify(oPayload, null, 2));
                        console.error("Response:", jqXHR.responseText);
                        console.error("=======================");
                        try {
                            var oErr = JSON.parse(jqXHR.responseText);
                            // Handle structured validation errors
                            if (oErr.invalidFields && Array.isArray(oErr.invalidFields) && oErr.invalidFields.length > 0) {
                                self._showFieldValidationErrors(oErr.invalidFields);
                                sMsg = self.getResourceBundle().getText("msgFieldsRequireAttention", [oErr.invalidFields.length]);
                            } else {
                                sMsg = oErr.message || oErr.error || oErr.Message || sMsg;
                            }
                        } catch (e) {
                            sMsg = jqXHR.responseText || sMsg;
                        }
                        MessageToast.show(sMsg);
                        console.error("Save error:", jqXHR.status, jqXHR.responseText);
                        self.setBusyOff();
                    }
                });
            };

            if (sHash) {
                fnPostData(sHash);
                return;
            }

            this.getoHashToken().done(function (oResult) {
                var sFetchedHash = oResult && oResult.hash;
                if (!sFetchedHash) {
                    MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
                    return;
                }
                fnPostData(sFetchedHash);
            }).fail(function () {
                MessageToast.show(self.getResourceBundle().getText("msgUnableToFetchHash"));
            });
        },




        onStaticTilePress: function (oEvent) {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            if (!oSelectedNode || !oSelectedNode.VN_ID) {
                MessageToast.show(this.getResourceBundle().getText("msgNoAssetSelected"));
                return;
            }
            var sDashboardId = oEvent.getSource().data("dashboardId");
            var sUrl = "https://trial.nexusic.com/?navigateTo=Asset&searchKey=VN_ID&searchValue=" + encodeURIComponent(oSelectedNode.VN_ID) + "&tab=Dashboard&dasboardId=" + sDashboardId;
            window.open(sUrl, "_blank");
        },

        onSharePress: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");
            if (!oSelectedNode || !oSelectedNode.CV_ID) {
                MessageToast.show(this.getResourceBundle().getText("msgNoAssetSelected"));
                return;
            }
            var sUrl = "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + encodeURIComponent(oSelectedNode.CV_ID);
            window.open(sUrl, "_blank");
        },

        onTileSharePress: function (oEvent) {
            var oBundle = this.getResourceBundle();
            var oContext = oEvent.getSource().getParent().getItems()[0].getBindingContext("LocalDataModel");
            if (oContext) {
                var sTileName = oContext.getProperty("Name");
                var sUrl = window.location.href;
                var sShareUrl = sUrl + (sUrl.indexOf("?") > -1 ? "&" : "?") + "tile=" + encodeURIComponent(sTileName);
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(sShareUrl).then(function () {
                        MessageToast.show(oBundle.getText("msgTileLinkCopied"));
                    }, function () {
                        MessageToast.show(oBundle.getText("msgFailedToCopyLink"));
                    });
                } else {
                    MessageToast.show(oBundle.getText("msgClipboardNotAvailable"));
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