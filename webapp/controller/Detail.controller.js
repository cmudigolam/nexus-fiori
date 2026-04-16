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
    "sap/m/MessageBox",
    "sap/m/Link",
    "sap/m/Popover",
    "sap/m/List",
    "sap/m/StandardListItem",
    "sap/m/DisplayListItem"
], (BaseController, MessageToast, Fragment, JSONModel, Label, Text, Input, DatePicker, CheckBox, Select, VBox, SimpleForm, Item, MessageBox, Link, Popover, List, StandardListItem, DisplayListItem) => {
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
            // Initialize for caching previous node and building node index
            this._sPreviousSelectedNodeId = null;
            this._oNodeInfoIndex = {};
            this._bNodeInfoIndexValid = false; // Track index validity with O(1) flag instead of Object.keys()
            
            // Monitor nodeInfoArray for changes to invalidate index
            var oLocalDataModel = this.getLocalDataModel();
            this._fnPropertyChangeListener = function(oEvent) {
                if (oEvent.getParameter("path") === "/nodeInfoArray") {
                    // Invalidate index when nodeInfoArray changes (O(1) flag instead of reset)
                    this._bNodeInfoIndexValid = false;
                }
            }.bind(this);
            oLocalDataModel.attachPropertyChange(this._fnPropertyChangeListener);

            // Load Unit and Unit_Type reference data on app start
            this._aUnitData = [];
            this._aUnitTypeData = [];
            this._oUserPreferredUnitByType = {}; // Map of UT_ID -> preferred Unit_ID from Unit_Item
            this._aRawUnitItems = []; // Raw Unit_Item records (Unit_Item has no UT_ID, needs cross-ref with Unit)
            this._bUserPreferredMapBuilt = false;
            this._loadUnitReferenceData();
        },

        _loadUnitReferenceData: function () {
            var self = this;
            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");

            var fnFetch = function (sResolvedHash) {
                // Load Unit data
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/Unit/",
                    "method": "GET",
                    "dataType": "json",
                    "data": { "hash": sResolvedHash, "pageSize": 1000 },
                    "success": function (response) {
                        self._aUnitData = Array.isArray(response && response.rows) ? response.rows
                            : (Array.isArray(response) ? response : []);
                    },
                    "error": function () {
                        console.warn("Failed to load Unit data");
                    }
                });

                // Load Unit_Type data
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/Unit_Type/",
                    "method": "GET",
                    "dataType": "json",
                    "data": { "hash": sResolvedHash, "pageSize": 1000 },
                    "success": function (response) {
                        self._aUnitTypeData = Array.isArray(response && response.rows) ? response.rows
                            : (Array.isArray(response) ? response : []);
                    },
                    "error": function () {
                        console.warn("Failed to load Unit_Type data");
                    }
                });
            };

            if (sHash) {
                fnFetch(sHash);
                // Need login id for user unit preferences
                self.getoHashToken().done(function (oResult) {
                    if (oResult && oResult.id) {
                        self._loadUserUnitPreferences(oResult.id, sHash);
                    }
                });
            } else {
                this.getoHashToken().done(function (oResult) {
                    var sFetchedHash = oResult && oResult.hash;
                    if (sFetchedHash) { fnFetch(sFetchedHash); }
                    // Load user unit preferences with the login id
                    if (oResult && oResult.id && sFetchedHash) {
                        self._loadUserUnitPreferences(oResult.id, sFetchedHash);
                    }
                });
            }
        },

        /**
         * After successful login, fetch Personnel record by SU_ID to get UG_ID,
         * then fetch Unit_Item preferences by UG_ID if available.
         */
        _loadUserUnitPreferences: function (iUserId, sHash) {
            var self = this;

            $.ajax({
                "url": self.isRunninglocally() + "/bo/Personnel/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "X-NEXUS-Filter": JSON.stringify({
                        "where": [{ "field": "SU_ID", "value": iUserId }]
                    })
                },
                "data": { "hash": sHash },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows
                        : (Array.isArray(response) ? response : []);

                    if (aRows.length === 0) { return; }

                    var oPersonnel = aRows[0];
                    var iUgId = oPersonnel.UG_ID;
                    if (!iUgId) { return; }

                    self._loadUnitItemsByGroup(iUgId, sHash);
                },
                "error": function () { /* silent - continue without preferences */ }
            });
        },

        /**
         * Fetch Unit_Item records for the user's Unit Group.
         * Unit_Item has Unit_ID but no UT_ID — must cross-ref with /bo/Unit/ data.
         */
        _loadUnitItemsByGroup: function (iUgId, sHash) {
            var self = this;

            $.ajax({
                "url": self.isRunninglocally() + "/bo/Unit_Item/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "X-NEXUS-Filter": JSON.stringify({
                        "where": [{ "field": "UG_ID", "method": "eq", "value": iUgId }]
                    })
                },
                "data": { "hash": sHash, "pageSize": 1000 },
                "success": function (response) {
                    var aItems = Array.isArray(response && response.rows) ? response.rows
                        : (Array.isArray(response) ? response : []);

                    self._aRawUnitItems = aItems;
                    self._bUserPreferredMapBuilt = false;
                },
                "error": function () { /* silent - continue without preferences */ }
            });
        },

        /**
         * Build index map of Full_Location -> node for O(1) lookups
         * @returns {Object} Object with Full_Location as key, node as value
         */
        _buildNodeInfoIndex: function() {
            var oLocalDataModel = this.getLocalDataModel();
            var aNodeInfoArray = oLocalDataModel.getProperty("/nodeInfoArray") || [];
            var oIndex = {};
            
            aNodeInfoArray.forEach(function(oNode) {
                var sFullLocation = this._getFullLocation(oNode);
                if (sFullLocation) {
                    oIndex[sFullLocation] = oNode;
                }
            }.bind(this));
            
            return oIndex;
        },
        onRouteMatched: function () {
            this.setBusyOff();
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");

            // If no asset is selected, select the first one by default
            if (!oSelectedNode) {
                var aNodeInfoArray = oLocalDataModel.getProperty("/nodeInfoArray");

                if (aNodeInfoArray && aNodeInfoArray.length > 0) {
                    oSelectedNode = aNodeInfoArray[0];
                    oLocalDataModel.setProperty("/selectedNodeData", oSelectedNode);

                    // Update breadcrumb for the first asset
                    this.updateBreadcrumb();

                    // Fetch detail tiles for the first asset
                    if (oSelectedNode.CT_ID) {
                        var sHash = oLocalDataModel.getProperty("/HashToken");
                        this.fetchDetailTiles(oSelectedNode.CT_ID, oSelectedNode.Component_ID, sHash);
                    }
                } else {
                    // Set up a listener to auto-select when data becomes available
                    this._fnDetailAutoSelectListener = function (oEvent) {
                        if (oEvent.getParameter("path") === "/nodeInfoArray") {
                            var aNewArray = oEvent.getParameter("value");
                            if (aNewArray && aNewArray.length > 0) {
                                var oFirstNode = aNewArray[0];
                                var oCurrentSelected = oLocalDataModel.getProperty("/selectedNodeData");
                                if (!oCurrentSelected) {
                                    oLocalDataModel.setProperty("/selectedNodeData", oFirstNode);
                                    this.updateBreadcrumb();
                                    if (oFirstNode.CT_ID) {
                                        var sHash = oLocalDataModel.getProperty("/HashToken");
                                        this.fetchDetailTiles(oFirstNode.CT_ID, oFirstNode.Component_ID, sHash);
                                    }
                                }
                                // Remove this listener after it fires once
                                oLocalDataModel.detachPropertyChange(this._fnDetailAutoSelectListener);
                            }
                        }
                    }.bind(this);
                    oLocalDataModel.attachPropertyChange(this._fnDetailAutoSelectListener);
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
            
            // Only rebuild breadcrumb if the selected node changed
            var sCurrentNodeId = oSelectedNode && oSelectedNode.VN_ID;
            if (sCurrentNodeId === this._sPreviousSelectedNodeId) {
                return; // No change, skip rebuild
            }
            
            this._sPreviousSelectedNodeId = sCurrentNodeId;
            
            var aBreadcrumb = [];
            if (oSelectedNode) {
                var fullLocation = this._getFullLocation(oSelectedNode);
                if (fullLocation) {
                    // Build breadcrumb using shared utility method from BaseController
                    aBreadcrumb = this._buildBreadcrumbSegments(fullLocation);
                }
            }
            
            oLocalDataModel.setProperty("/breadcrumb", aBreadcrumb);
        },
        
        onExit: function() {
            // Clean up all property change listeners to prevent memory leaks
            var oLocalDataModel = this.getLocalDataModel();
            if (oLocalDataModel) {
                if (this._fnPropertyChangeListener) {
                    oLocalDataModel.detachPropertyChange(this._fnPropertyChangeListener);
                }
                if (this._fnDetailAutoSelectListener) {
                    oLocalDataModel.detachPropertyChange(this._fnDetailAutoSelectListener);
                }
            }
        },

        onBreadcrumbPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            var oData = oContext.getObject();
            var sTargetFullLocation = oData.fullLocation;
            
            if (!sTargetFullLocation) {
                return;
            }
            
            var oLocalDataModel = this.getLocalDataModel();
            
            // Build or use cached index for O(1) lookup (O(1) validity check instead of Object.keys())
            if (!this._bNodeInfoIndexValid) {
                this._oNodeInfoIndex = this._buildNodeInfoIndex();
                this._bNodeInfoIndexValid = true;
            }
            
            // O(1) lookup instead of O(n) linear search
            var oNode = this._oNodeInfoIndex[sTargetFullLocation];
            
            if (!oNode || !oNode.CV_ID || !oNode.CT_ID) {
                return;
            }
            
            oLocalDataModel.setProperty("/selectedNodeData", oNode);
            
            // Tell Master to focus/select this node in the tree
            sap.ui.getCore().getEventBus().publish("Master", "FocusNodeFromBreadcrumb", {
                nodeData: oNode
            });
            
            // Trigger same action as node selection
            this.fetchDetailTiles(oNode.CT_ID, oNode.Component_ID, oLocalDataModel.getProperty("/HashToken"));
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
                    "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sTableName),
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
                        // Extract data from response
                        var oRecord = response;
                        if (Array.isArray(response.rows) && response.rows.length > 0) {
                            oRecord = response.rows[0];
                        } else if (Array.isArray(response) && response.length > 0) {
                            oRecord = response[0];
                        }

                        var sFunctionalLocation = oRecord.Functional_Location || "";
                        var sExternalReferenceId = oRecord.External_Reference_ID || "";
                        var sEquipmentId = oRecord.Equipment_Number || "";
                        if (sEquipmentId && sExternalReferenceId.length > 0 && sExternalReferenceId.length < 18) {
                            sExternalReferenceId = sExternalReferenceId.padStart(18, "0");
                        }
                        // Navigate to SAP with the extracted values
                        var sUrl = "https://pipl-sapa23.pilogcloud.com:8100/sap/bc/ui2/flp?sap-client=100&sap-language=EN#MaintenanceObject-displayFactSheet";
                        if (sEquipmentId) {
                            sUrl += "&/C_ObjPgTechnicalObject(TechObjIsEquipOrFuncnlLoc='EAMS_EQUI',TechnicalObject=%27" + encodeURIComponent(sExternalReferenceId) + "%27)";
                        } else if (sFunctionalLocation) {
                            sUrl += "&/C_ObjPgTechnicalObject(TechObjIsEquipOrFuncnlLoc='EAMS_FL',TechnicalObject=%27" + encodeURIComponent(sExternalReferenceId) + "%27)";
                        }
                        if (sEquipmentId == "" && sFunctionalLocation == "") {
                            MessageBox.error(self.getResourceBundle().getText("msgNoValidReference"));
                            self.setBusyOff();
                            return;
                        }
                        window.open(sUrl, "_blank"); // _self
                        self.setBusyOff();
                    },
                    "error": function () {
                        MessageBox.error(self.getResourceBundle().getText("msgErrorFetchingExternalReferences"));
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
            self._fieldVisibilityMap = {};
            self._fieldBusinessObjectMap = {};
            self._linkedDataByBO = {};
            self._cascadeFieldOrder = {};
            self._colourInputMap = {};
            self._colourValueMap = {};
            self._unitLinkMap = {};
            self._unitFieldInfo = {};
            self._categoryTabMap = {};
            self._pendingComboBoxValues = {};
            self._pendingLookupCount = 0;
            self._formDataTableName = sTableName;
            self._subTableControls = [];
            self._nestedLookupFieldMap = {};
            self._nestedForeignKeyFieldMap = {};

            var fnBuildAndOpen = function () {
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
            };

            var sHash = self.getLocalDataModel().getProperty("/HashToken");
            if (sHash) {
                self._expandForeignTableFields(oFormData, oCategorizedFields, sHash, fnBuildAndOpen);
            } else {
                self.getoHashToken().done(function (oResult) {
                    var sFetchedHash = oResult && oResult.hash;
                    self._expandForeignTableFields(oFormData, oCategorizedFields, sFetchedHash || "", fnBuildAndOpen);
                }).fail(function () {
                    fnBuildAndOpen();
                });
            }
        },
        _expandForeignTableFields: function (oFormData, oCategorizedFields, sResolvedHash, fnCallback) {
            var self = this;
            var aFields = Array.isArray(oFormData && oFormData.fields) ? oFormData.fields : [];

            // Find all fields that are foreign-table references
            var aForeignFields = aFields.filter(function (oField) {
                return oField.fieldTypeId === 19  && oField.foreignTableId;
            });

            if (aForeignFields.length === 0) {
                fnCallback();
                return;
            }

            var iRemaining = aForeignFields.length;

            aForeignFields.forEach(function (oForeignField) {
                var sForeignTableId = oForeignField.foreignTableId;
                var sParentCategory = oForeignField.category ||
                    (oFormData.categories && oFormData.categories[0] && oFormData.categories[0].name) || "General";

                $.ajax({
                    "url": self.isRunninglocally() + "/boByKey/" + encodeURIComponent(sForeignTableId),
                    "method": "GET",
                    "dataType": "json",
                    "data": { "hash": sResolvedHash },
                    "success": function (response) {
                        var aResponseFields = Array.isArray(response && response.fields) ? response.fields : [];

                        // businessObjectName and filter field are on oForeignField.nestedField
                        // (from the parent /bo/ response, e.g. "Material" field carries:
                        //   nestedField.businessObjectName = "LT_Material_Selection__Piping_"
                        //   nestedField.fieldName          = "Material_Selection__Piping__ID")
                        var oNestedField = oForeignField.nestedField;
                        var sBusinessObjectName = oNestedField && oNestedField.businessObjectName;
                        var sFilterField = oNestedField && oNestedField.fieldName;

                        if (sBusinessObjectName && sFilterField) {
                            var sParentTableName = self._formDataTableName;
                            var sParentFieldName = oForeignField.fieldName || oForeignField.name;
                            var sCompId = self.getLocalDataModel().getProperty("/sCompoonentID");

                            if (sParentTableName && sCompId) {
                                // Step 1: fetch the parent record to read the link value
                                // e.g. /bo/CIG_Piping_Data/{compId} → record["Material"] → 8
                                $.ajax({
                                    "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sParentTableName) + "/" + encodeURIComponent(sCompId),
                                    "method": "GET",
                                    "dataType": "json",
                                    "data": { "hash": sResolvedHash },
                                    "success": function (parentResponse) {
                                        var oParentRecord = parentResponse;
                                        if (Array.isArray(parentResponse.rows) && parentResponse.rows.length > 0) {
                                            oParentRecord = parentResponse.rows[0];
                                        } else if (Array.isArray(parentResponse) && parentResponse.length > 0) {
                                            oParentRecord = parentResponse[0];
                                        }

                                        var vLinkValue = oParentRecord && oParentRecord[sParentFieldName];
                                        if (vLinkValue === undefined || vLinkValue === null) { return; }

                                        // Step 2: call /bo/{businessObjectName} to load all data (no filter)
                                        // e.g. /bo/LT_Material_Selection__Piping_
                                        $.ajax({
                                            "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sBusinessObjectName)+"/",
                                            "method": "GET",
                                            "dataType": "json",
                                            "data": { "hash": sResolvedHash, "pagesize": 1000 },
                                            "success": function (linkedResponse) {
                                                oForeignField._linkedData = linkedResponse;
                                                // Store full dataset per BO for cascade filtering
                                                var aAllRows = [];
                                                if (Array.isArray(linkedResponse.rows) && linkedResponse.rows.length > 0) {
                                                    aAllRows = linkedResponse.rows;
                                                } else if (Array.isArray(linkedResponse) && linkedResponse.length > 0) {
                                                    aAllRows = linkedResponse;
                                                }
                                                self._linkedDataByBO[sBusinessObjectName] = aAllRows;
                                                // Store match info so _populateLinkedFields can find the correct row
                                                self._linkedFieldMatchInfo = self._linkedFieldMatchInfo || {};
                                                self._linkedFieldMatchInfo[sBusinessObjectName] = {
                                                    filterField: sFilterField,
                                                    linkValue: vLinkValue
                                                };
                                                // Populate the expanded UI controls scoped to this business object only
                                                self._populateLinkedFields(linkedResponse, sBusinessObjectName);
                                            },
                                            "error": function () { /* silent – linked data unavailable */ }
                                        });
                                    }
                                });
                            }
                        }

                        // Only include fields where gridVisible is explicitly true
                        var aVisibleFields = aResponseFields.filter(function (oColField) {
                            return oColField.gridVisible === true;
                        });
                        // Stamp each expanded field with the parent's category and business object name
                        // Force formVisible to true for fields selected by gridVisible,
                        // so they are not hidden by buildFormContent's formVisible check
                        aVisibleFields.forEach(function (oExpandedField) {
                            oExpandedField.category = sParentCategory;
                            oExpandedField.formVisible = true;
                            if (sBusinessObjectName) {
                                oExpandedField._businessObjectName = sBusinessObjectName;
                            }
                        });

                        // Replace the foreign-reference field with the expanded fields in oFormData.fields
                        var iIdx = oFormData.fields.indexOf(oForeignField);
                        if (iIdx !== -1) {
                            oFormData.fields.splice.apply(oFormData.fields, [iIdx, 1].concat(aVisibleFields));
                        }
                        // Replace in oCategorizedFields
                        if (oCategorizedFields[sParentCategory]) {
                            var iCatIdx = oCategorizedFields[sParentCategory].indexOf(oForeignField);
                            if (iCatIdx !== -1) {
                                oCategorizedFields[sParentCategory].splice.apply(
                                    oCategorizedFields[sParentCategory],
                                    [iCatIdx, 1].concat(aVisibleFields)
                                );
                            }
                        }

                        iRemaining--;
                        if (iRemaining === 0) { fnCallback(); }
                    },
                    "error": function () {
                        // On error, remove the unresolvable foreign field and continue
                        var iIdx = oFormData.fields.indexOf(oForeignField);
                        if (iIdx !== -1) { oFormData.fields.splice(iIdx, 1); }
                        if (oCategorizedFields[sParentCategory]) {
                            var iCatIdx = oCategorizedFields[sParentCategory].indexOf(oForeignField);
                            if (iCatIdx !== -1) { oCategorizedFields[sParentCategory].splice(iCatIdx, 1); }
                        }
                        iRemaining--;
                        if (iRemaining === 0) { fnCallback(); }
                    }
                });
            });
        },
        buildFormContent: function (oFormData, oCategorizedFields) {
            var oTabBar = this._oFormDialog.getContent()[0];
            oTabBar.destroyItems();

            var self = this;
            var aCategories = Array.isArray(oFormData && oFormData.categories) && oFormData.categories.length
                ? oFormData.categories
                : [{ name: "General" }];

            // Keep category order aligned to metadata field ordering.
            // Category order is defined by the lowest formOrder among visible fields in that category.
            var oCategoryOriginalIndex = {};
            aCategories.forEach(function (oCategory, iIndex) {
                oCategoryOriginalIndex[oCategory.name] = iIndex;
            });

            var oCategoryMinOrder = {};
            aCategories.forEach(function (oCategory) {
                oCategoryMinOrder[oCategory.name] = Number.POSITIVE_INFINITY;
            });

            aCategories.forEach(function (oCategory) {
                var aCategoryFields = Array.isArray(oCategorizedFields[oCategory.name]) ? oCategorizedFields[oCategory.name] : [];
                aCategoryFields.forEach(function (oField) {
                    if (!oField || (oField.gridVisible !== true && oField.formVisible !== true)) {
                        return;
                    }
                    var iOrder = parseInt(oField.formOrder, 10);
                    if (!Number.isNaN(iOrder) && iOrder < oCategoryMinOrder[oCategory.name]) {
                        oCategoryMinOrder[oCategory.name] = iOrder;
                    }
                });
            });

            aCategories = aCategories.slice().sort(function (a, b) {
                var iA = oCategoryMinOrder[a.name];
                var iB = oCategoryMinOrder[b.name];
                if (iA !== iB) {
                    return iA - iB;
                }
                return oCategoryOriginalIndex[a.name] - oCategoryOriginalIndex[b.name];
            });

            if (!oCategorizedFields.General && aCategories.length === 1 && aCategories[0].name === "General") {
                oCategorizedFields.General = Array.isArray(oFormData && oFormData.fields) ? oFormData.fields : [];
            }

            // Create a tab for each category
            aCategories.forEach(function (oCategory, iIndex) {
                var aFormContent = [];
                var aSubTableBlocks = []; // sub-table controls rendered above the form

                if (oCategorizedFields[oCategory.name] && oCategorizedFields[oCategory.name].length > 0) {
                    // Sort fields by formOrder before processing
                    var aSortedFields = oCategorizedFields[oCategory.name].slice().sort(function (a, b) {
                        var aOrder = a.formOrder !== undefined ? parseInt(a.formOrder) : 999999;
                        var bOrder = b.formOrder !== undefined ? parseInt(b.formOrder) : 999999;
                        return aOrder - bOrder;
                    });

                    // Group fields: BO fields together, non-BO fields separate
                    var aBoGroups = [];
                    var oBoPosMap = {};
                    var aNonBoFields = [];
                    aSortedFields.forEach(function (oField) {
                        var sBo = oField._businessObjectName;
                        if (sBo) {
                            if (oBoPosMap[sBo] === undefined) {
                                oBoPosMap[sBo] = aBoGroups.length;
                                aBoGroups.push({ bo: sBo, fields: [] });
                            }
                            aBoGroups[oBoPosMap[sBo]].fields.push(oField);
                        } else {
                            aNonBoFields.push(oField);
                        }
                    });
                    // Rebuild sorted fields: non-BO fields first, then each BO group
                    aSortedFields = aNonBoFields;
                    aBoGroups.forEach(function (oGroup) {
                        // Insert a separator marker for BO group
                        aSortedFields.push({ _boGroupTitle: oGroup.bo, _isGroupSeparator: true });
                        aSortedFields = aSortedFields.concat(oGroup.fields);
                    });

                    aSortedFields.forEach(function (oField) {
                        // Render BO group separator title
                        if (oField._isGroupSeparator) {
                            var oTitle = new sap.ui.core.Title({ text: oField._boGroupTitle.replace(/_/g, " ").replace(/^LT\s+/i, "") });
                            aFormContent.push(oTitle);
                            return;
                        }

                        // Determine visibility based on formVisible property from API metadata
                        var bVisible = oField.formVisible !== false;

                        // Sub-table fields are rendered above the form, not inside it
                        if (oField.subTableId) {
                            var oTable = self.createFieldControl(oField);
                            oTable.setVisible(bVisible);
                            var sFieldKey = oField.fieldName || oField.name;
                            if (sFieldKey) {
                                self._fieldControlMap[sFieldKey] = oTable;
                            }
                            // Track for form-level save
                            self._subTableControls = self._subTableControls || [];
                            self._subTableControls.push(oTable);
                            // Wrap in a titled VBox so the field label appears above the table
                            var oTitleLabel = new sap.m.Label({
                                text: oField.name || oField.fieldName,
                                required: oField.required || false
                            });
                            oTitleLabel.addStyleClass("sapUiSmallMarginTop");
                            var oVBox = new sap.m.VBox({
                                items: [oTitleLabel, oTable],
                                visible: bVisible
                            });
                            oVBox.addStyleClass("sapUiSmallMarginBegin sapUiSmallMarginEnd sapUiSmallMarginBottom");
                            if (sFieldKey) {
                                self._fieldVisibilityMap[sFieldKey] = {
                                    label: oTitleLabel,
                                    container: oVBox
                                };
                            }
                            aSubTableBlocks.push(oVBox);
                            return; // skip adding to aFormContent
                        }

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
                        if (sFieldKey) {
                            self._fieldControlMap[sFieldKey] = oInput;
                            self._fieldVisibilityMap[sFieldKey] = {
                                label: oLabel,
                                container: oInput
                            };
                            if (oField._businessObjectName) {
                                self._fieldBusinessObjectMap[sFieldKey] = oField._businessObjectName;
                            }
                            if (/colour/i.test(oField.name || oField.fieldName || "")) {
                                self._colourInputMap[sFieldKey] = oInput;
                            }
                        }

                        // Check if field has a unitId — add unit symbol link
                        var bHasUnit = oField.unitId !== undefined && oField.unitId !== null;
                        var oUnitLink = null;
                        if (bHasUnit) {
                            var oUnitInfo = self._getUnitInfoForField(oField.unitId);
                            if (oUnitInfo && oUnitInfo.symbol) {
                                // Ensure preference map is built from Unit_Item + Unit cross-reference
                                self._ensureUserPreferredUnitMap();
                                // Check for user preferred unit for this unit type
                                var iPreferredUnitId = self._oUserPreferredUnitByType
                                    ? self._oUserPreferredUnitByType[Number(oUnitInfo.utId)]
                                    : null;
                                var sDisplaySymbol = oUnitInfo.symbol;
                                var fInitGradient = 1;
                                var fInitConstant = 0;

                                if (iPreferredUnitId !== null && iPreferredUnitId !== undefined) {
                                    var oPreferredUnit = self._aUnitData.find(function (oU) {
                                        return Number(oU.Unit_ID) === Number(iPreferredUnitId) && Number(oU.UT_ID) === Number(oUnitInfo.utId);
                                    });
                                    if (oPreferredUnit) {
                                        sDisplaySymbol = oPreferredUnit.Symbol || sDisplaySymbol;
                                        fInitGradient = parseFloat(oPreferredUnit.Gradient) || 1;
                                        fInitConstant = parseFloat(oPreferredUnit.Constant) || 0;
                                    }
                                }

                                oUnitLink = new Link({
                                    text: sDisplaySymbol,
                                    press: self._onUnitSymbolPress.bind(self, sFieldKey, oField.unitId)
                                });
                                oUnitLink.addStyleClass("uomUnitLink");
                                // Store link reference and current unit info for later updates
                                self._unitLinkMap[sFieldKey] = oUnitLink;
                                self._unitFieldInfo[sFieldKey] = {
                                    unitId: oField.unitId,
                                    defaultSymbol: oUnitInfo.symbol,
                                    currentSymbol: sDisplaySymbol,
                                    currentGradient: fInitGradient,
                                    currentConstant: fInitConstant
                                };
                            }
                        }

                        if (bVisible && Number(oField.fieldTypeId) == 40 && !oField.subTableId) {
                            // Create Button
                            var oButton = new sap.m.Button({
                                text: "ƒ",
                                press: self._onFieldImageButtonPress.bind(self, sFieldKey)
                            });
                            oButton.addStyleClass("italicButton");

                            // Input fills remaining space; button and unit link stay compact
                            oInput.setLayoutData(new sap.m.FlexItemData({ growFactor: 1, shrinkFactor: 1, minWidth: "0" }));
                            oButton.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                            var aHBoxItems = [oInput, oButton];
                            if (oUnitLink) {
                                oUnitLink.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                                aHBoxItems.push(oUnitLink);
                            }

                            var oHBox = new sap.m.HBox({
                                items: aHBoxItems,
                                renderType: "Bare",
                                alignItems: "Center",
                                width: "100%"
                            });
                            if (sFieldKey) {
                                self._fieldVisibilityMap[sFieldKey].container = oHBox;
                            }
                            aFormContent.push(oHBox);
                        }
                        else if (bVisible && Number(oField.fieldTypeId) == 18) {
                            // Create ƒ(p) button for global table lookup fields (fieldTypeId 18 only)
                            var oGlobalBtn = new sap.m.Button({
                                text: "ƒ(p)",
                                press: self._onGlobalTableInfoPress.bind(self, oField)
                            });
                            oGlobalBtn.addStyleClass("italicButton");

                            // Disable the form field for fieldTypeId 18 (value set via ƒ(p) lookup)
                            oInput.setEnabled(false);

                            oInput.setLayoutData(new sap.m.FlexItemData({ growFactor: 1, shrinkFactor: 1, minWidth: "0" }));
                            oGlobalBtn.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                            var aHBoxItems = [oInput, oGlobalBtn];
                            if (oUnitLink) {
                                oUnitLink.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                                aHBoxItems.push(oUnitLink);
                            }

                            var oHBox = new sap.m.HBox({
                                items: aHBoxItems,
                                renderType: "Bare",
                                alignItems: "Center",
                                width: "100%"
                            });
                            if (sFieldKey) {
                                self._fieldVisibilityMap[sFieldKey].container = oHBox;
                            }
                            aFormContent.push(oHBox);
                        }
                        else if (bVisible && Number(oField.fieldTypeId) == 42) {
                            // Create ƒ(n) button for global table lookup fields
                            var oGlobalNBtn = new sap.m.Button({
                                text: "ƒ(n)",
                                press: self._onGlobalTableInfoPress.bind(self, oField)
                            });
                            oGlobalNBtn.addStyleClass("italicButton");

                            oInput.setLayoutData(new sap.m.FlexItemData({ growFactor: 1, shrinkFactor: 1, minWidth: "0" }));
                            oGlobalNBtn.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                            var aHBoxItems = [oInput, oGlobalNBtn];
                            if (oUnitLink) {
                                oUnitLink.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                                aHBoxItems.push(oUnitLink);
                            }

                            var oHBox = new sap.m.HBox({
                                items: aHBoxItems,
                                renderType: "Bare",
                                alignItems: "Center",
                                width: "100%"
                            });
                            if (sFieldKey) {
                                self._fieldVisibilityMap[sFieldKey].container = oHBox;
                            }
                            aFormContent.push(oHBox);
                        }
                        else if (oUnitLink) {
                            // Input fills remaining space; unit link stays compact on the right
                            oInput.setLayoutData(new sap.m.FlexItemData({ growFactor: 1, shrinkFactor: 1, minWidth: "0" }));
                            oUnitLink.setLayoutData(new sap.m.FlexItemData({ growFactor: 0, shrinkFactor: 0 }));
                            var oHBox = new sap.m.HBox({
                                items: [oInput, oUnitLink],
                                renderType: "Bare",
                                alignItems: "Center",
                                width: "100%"
                            });
                            if (sFieldKey) {
                                self._fieldVisibilityMap[sFieldKey].container = oHBox;
                            }
                            aFormContent.push(oHBox);
                        }
                        else
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

                // Build scroll content: optional comment text, then sub-tables, then the form
                var aScrollContent = [];
                if (oCategory.comments) {
                    var oCommentText = new sap.m.Text({
                        text: oCategory.comments,
                        wrapping: true
                    });
                    oCommentText.addStyleClass("sapUiSmallMarginBegin sapUiSmallMarginEnd sapUiSmallMarginTop");
                    aScrollContent.push(oCommentText);
                }
                // Sub-tables appear above the form fields
                aSubTableBlocks.forEach(function (oBlock) {
                    aScrollContent.push(oBlock);
                });
                aScrollContent.push(oSimpleForm);

                // Create ScrollContainer for the form
                var oScrollContainer = new sap.m.ScrollContainer({
                    vertical: true,
                    horizontal: true,
                    height: "100%",
                    content: aScrollContent
                });

                // Create tab for this category
                var oTab = new sap.m.IconTabFilter({
                    text: oCategory.name,
                    key: "tab" + iIndex,
                    content: [oScrollContainer]
                });

                // Store reference so we can show/hide after validation
                self._categoryTabMap[oCategory.name] = oTab;
                oTabBar.addItem(oTab);
            });
        },
        createFieldControl: function (oField) {
            // If field has a subTableId, create an sap.m.Table and load columns from boByKey
            if (oField.subTableId) {
                this._pendingLookupCount++;
                var oTable = new sap.m.Table({
                    growing: true,
                    growingScrollToLoad: true,
                    noDataText: "No data"
                });
                this._loadSubTableColumns(oTable, oField.subTableId, oField.category);
                return oTable;
            }

            // If field has a lookupListId, create a Select/ComboBox and load lookup items
            if (oField.lookupListId) {
                this._pendingLookupCount++;
                var oSelect = Number(oField.fieldTypeId) === 37
                    ? new sap.m.ComboBox({ width: "100%" })
                    : new sap.m.Select({
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
                        displayFormat: "dd MMM yyyy"
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
                case 16: // Multi-line text field
                    return new sap.m.TextArea({
                        growing: true,
                        growingMaxLines: 6,
                        width: "100%"
                    });
                case 37: // Editable dropdown field (ComboBox)
                    var oSelect = new sap.m.ComboBox({
                        width: "100%"
                    });
                    return oSelect;
                case 40: // Sub-table
                    return new sap.m.Input({
                        //placeholder: oField.name || oField.fieldName,
                        enabled: false
                    });
                case 18: // Nested lookup or sub-table
                    if (oField.nestedField && oField.nestedField.lookupListId) {
                        this._nestedLookupFieldMap = this._nestedLookupFieldMap || {};
                        this._nestedLookupFieldMap[oField.fieldName] = oField.nestedField.lookupListId;
                    } else if (oField.nestedField && oField.nestedField.foreignTableId &&
                               oField.nestedField.nestedField && oField.nestedField.nestedField.businessObjectName) {
                        this._nestedForeignKeyFieldMap = this._nestedForeignKeyFieldMap || {};
                        this._nestedForeignKeyFieldMap[oField.fieldName] = {
                            businessObjectName: oField.nestedField.nestedField.businessObjectName,
                            displayFieldName: oField.nestedField.nestedField.fieldName || "Name"
                        };
                    }
                    return new sap.m.Input({
                        //placeholder: oField.name || oField.fieldName,
                        enabled: false
                    });
                case 42: // Sub-table
                    return new sap.m.Input({
                        //placeholder: oField.name || oField.fieldName,
                        enabled: false
                    });
                case 1: // Global table lookups
                    var oSelect = new sap.m.Select({
                        width: "100%"
                    });
                    return oSelect;
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
                    "url": self.isRunninglocally() + "/bo/Lookup_Item/",
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
                        oSelect.removeAllItems();
                        aItems.forEach(function (oItem) {
                            // Use LI_ID as the key (internal identifier stored in database)
                            // Use Value as the display text (what user sees)
                            var sKey = String(oItem.LI_ID || oItem.Value || "");
                            var sText = String(oItem.Value || oItem.Name || oItem.Description || "");
                            oSelect.addItem(new Item({
                                key: sKey,
                                text: sText
                            }));
                        });

                        // After items are loaded, apply any pending value selection
                        self._applyPendingComboBoxValues();

                        // Decrement pending lookup count
                        self._pendingLookupCount--;

                        // If all lookups are done, load form data
                        if (self._pendingLookupCount === 0 && self._formDataTableName) {
                            self._loadFormData(self._formDataTableName);
                        }
                    },
                    "error": function () {
                        MessageToast.show(self.getResourceBundle().getText("msgErrorLoadingLookupItems"));

                        // Decrement pending lookup count even on error
                        self._pendingLookupCount--;

                        // If all lookups are done (or failed), load form data
                        if (self._pendingLookupCount === 0 && self._formDataTableName) {
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
        /**
         * For every field registered in _nestedLookupFieldMap (fieldTypeId 18 whose
         * nestedField carries a lookupListId), fetch the matching Lookup_Item record
         * using the raw ID stored in oRecord and display its Value text on the control.
         */
        _resolveNestedLookupFields: function (oRecord, sHash) { // need to check
            var self = this;
            if (!this._nestedLookupFieldMap || !oRecord) {
                return;
            }
            Object.keys(this._nestedLookupFieldMap).forEach(function (sFieldKey) {
                var vFieldValue = oRecord[sFieldKey];
                if (vFieldValue === undefined || vFieldValue === null || vFieldValue === "") {
                    return;
                }
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/Lookup_Item/",
                    "method": "GET",
                    "dataType": "json",
                    "headers": {
                        "X-NEXUS-Filter": JSON.stringify({
                            "where": [{ "field": "LI_ID", "method": "eq", "value": vFieldValue }]
                        })
                    },
                    "data": {
                        "hash": sHash
                    },
                    "success": function (response) {
                        var aRows = Array.isArray(response && response.rows) ? response.rows
                            : Array.isArray(response) ? response : [];
                        var oControl = self._fieldControlMap && self._fieldControlMap[sFieldKey];
                        if (!oControl || !oControl.isA("sap.m.Input")) {
                            return;
                        }
                        if (aRows.length > 0) {
                            var sDisplayValue = String(aRows[0].Value || aRows[0].Name || vFieldValue);
                            oControl.setValue(sDisplayValue);
                        } else {
                            // Fallback: show raw value when no matching lookup item found
                            oControl.setValue(String(vFieldValue));
                        }
                    },
                    "error": function () {
                        // Silent fallback – display raw stored value
                        var oControl = self._fieldControlMap && self._fieldControlMap[sFieldKey];
                        if (oControl && oControl.isA("sap.m.Input")) {
                            oControl.setValue(String(vFieldValue));
                        }
                    }
                });
            });

            // Resolve fields backed by nestedField.foreignTableId + nestedField.nestedField.businessObjectName
            // Calls /bo/{businessObjectName}/{value} and displays the nestedField.nestedField.fieldName value
            if (this._nestedForeignKeyFieldMap) {
                Object.keys(this._nestedForeignKeyFieldMap).forEach(function (sFieldKey) {
                    var oFieldInfo = self._nestedForeignKeyFieldMap[sFieldKey];
                    var vFieldValue = oRecord[sFieldKey];
                    if (vFieldValue === undefined || vFieldValue === null || vFieldValue === "") {
                        return;
                    }
                    $.ajax({
                        "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(oFieldInfo.businessObjectName) + "/" + encodeURIComponent(vFieldValue),
                        "method": "GET",
                        "dataType": "json",
                        "data": { "hash": sHash },
                        "success": function (response) {
                            var oRow = response;
                            if (Array.isArray(response && response.rows) && response.rows.length > 0) {
                                oRow = response.rows[0];
                            } else if (Array.isArray(response) && response.length > 0) {
                                oRow = response[0];
                            }
                            var oControl = self._fieldControlMap && self._fieldControlMap[sFieldKey];
                            if (!oControl || !oControl.isA("sap.m.Input")) {
                                return;
                            }
                            var sDisplayValue = oRow && (oRow[oFieldInfo.displayFieldName] || oRow.Name);
                            oControl.setValue(sDisplayValue ? String(sDisplayValue) : String(vFieldValue));
                        },
                        "error": function () {
                            var oControl = self._fieldControlMap && self._fieldControlMap[sFieldKey];
                            if (oControl && oControl.isA("sap.m.Input")) {
                                oControl.setValue(String(vFieldValue));
                            }
                        }
                    });
                });
            }
        },
        _loadSubTableColumns: function (oTable, sSubTableId, sFieldName) {
            var oLocalDataModel = this.getLocalDataModel();
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            var fnFetch = function (sResolvedHash) {
                $.ajax({
                    "url": self.isRunninglocally() + "/boByKey/" + encodeURIComponent(sSubTableId),
                    "method": "GET",
                    "dataType": "json",
                    "data": {
                        "hash": sResolvedHash
                    },
                    "success": function (response) {
                        var aFields = Array.isArray(response && response.fields) ? response.fields : [];
                        // Only include fields where gridVisible is not explicitly false
                        var aVisibleFields = aFields.filter(function (oColField) {
                            return oColField.gridVisible !== false;
                        });
                        aVisibleFields.forEach(function (oColField) {
                            var sColName = oColField.name || oColField.fieldName || "";
                            oTable.addColumn(new sap.m.Column({
                                header: new sap.m.Text({ text: sColName })
                            }));
                        });
                        // Store only visible field metadata so row cells align with columns
                        oTable.data("subTableFields", aVisibleFields);

                        // Use the field's own fieldName from the parent form as the category name.
                        // response.name is a display name (may have spaces) and should not be used
                        // as the /bo/ API path segment.
                        var sCategoryName = response.tableName || "";
                        oTable.data("subTableName", sCategoryName);

                        // Enable row selection for delete operations
                        oTable.setMode("MultiSelect");

                        // Add toolbar with Add / Delete buttons (Save is handled by the form Save button)
                        oTable.setHeaderToolbar(new sap.m.Toolbar({
                            content: [
                                new sap.m.ToolbarSpacer(),
                                new sap.m.Button({
                                    text: "Add",
                                    icon: "sap-icon://add",
                                    press: self._onSubTableAddRow.bind(self, oTable)
                                }),
                                new sap.m.Button({
                                    text: "Delete",
                                    icon: "sap-icon://delete",
                                    press: self._onSubTableDeleteRows.bind(self, oTable, sCategoryName, sResolvedHash)
                                })
                            ]
                        }));

                        // Pre-load lookup items for every dropdown column so editable cells
                        // can be populated before rows are rendered.
                        var aDropdownFields = aVisibleFields.filter(function (oColField) {
                            return !!oColField.lookupListId;
                        });
                        var oSubTableLookups = {};
                        oTable.data("subTableLookups", oSubTableLookups);

                        var fnProceedWithData = function () {
                            if (sCategoryName) {
                                self._loadSubTableData(oTable, sCategoryName, aVisibleFields, sResolvedHash, oSubTableLookups);
                            }
                            self._pendingLookupCount--;
                            if (self._pendingLookupCount === 0 && self._formDataTableName) {
                                self._loadFormData(self._formDataTableName);
                            }
                        };

                        if (aDropdownFields.length === 0) {
                            fnProceedWithData();
                            return;
                        }

                        var iRemainingLookups = aDropdownFields.length;
                        aDropdownFields.forEach(function (oColField) {
                            var sFieldKey = oColField.fieldName || oColField.name;
                            $.ajax({
                                "url": self.isRunninglocally() + "/bo/Lookup_Item/",
                                "method": "GET",
                                "dataType": "json",
                                "headers": {
                                    "X-NEXUS-Filter": JSON.stringify({ "where": [{ "field": "LL_ID", "method": "eq", "value": oColField.lookupListId }] }),
                                    "X-NEXUS-Sort": JSON.stringify([{ "field": "Value", "ascending": true }])
                                },
                                "data": { "hash": sResolvedHash },
                                "success": function (resp) {
                                    oSubTableLookups[sFieldKey] = Array.isArray(resp && resp.rows) ? resp.rows : [];
                                    iRemainingLookups--;
                                    if (iRemainingLookups === 0) { fnProceedWithData(); }
                                },
                                "error": function () {
                                    oSubTableLookups[sFieldKey] = [];
                                    iRemainingLookups--;
                                    if (iRemainingLookups === 0) { fnProceedWithData(); }
                                }
                            });
                        });
                    },
                    "error": function () {
                        MessageToast.show(self.getResourceBundle().getText("msgErrorLoadingLookupItems"));
                        self._pendingLookupCount--;
                        if (self._pendingLookupCount === 0 && self._formDataTableName) {
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
                } else {
                    self._pendingLookupCount--;
                }
            }).fail(function () {
                self._pendingLookupCount--;
            });
        },
        _loadSubTableData: function (oTable, sCategoryName, aVisibleFields, sResolvedHash, oSubTableLookups) {
            var oLocalDataModel = this.getLocalDataModel();
            var sComponentId = oLocalDataModel.getProperty("/sCompoonentID");
            var self = this;

            if (!sComponentId || !sCategoryName) {
                return;
            }

            $.ajax({
                "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sCategoryName) + "/",
                "method": "GET",
                "dataType": "json",
                "headers": {
                    "x-nexus-filter": JSON.stringify({ "where": [{ "field": "Component_ID", "value": sComponentId }] })
                },
                "data": {
                    "hash": sResolvedHash
                },
                "success": function (response) {
                    var aRows = Array.isArray(response && response.rows) ? response.rows
                        : (Array.isArray(response) ? response : []);

                    oTable.removeAllItems();
                    aRows.forEach(function (oRow) {
                        var aCells = aVisibleFields.map(function (oColField) {
                            var sCellField = oColField.fieldName || oColField.name;
                            var vVal = oRow[sCellField];
                            // Resolve nested display value (e.g. lookup object)
                            if (vVal !== null && vVal !== undefined && typeof vVal === "object") {
                                if (oColField.nestedField) {
                                    if (oColField.lookupListId) {
                                        // For lookup fields use Comments as the display/matching value
                                        vVal = vVal["Comments"] || vVal[oColField.nestedField.fieldName || oColField.nestedField.name];
                                    } else {
                                        var sNestedKey = oColField.nestedField.fieldName || oColField.nestedField.name;
                                        vVal = sNestedKey ? vVal[sNestedKey] : vVal;
                                    }
                                } else {
                                    // No nestedField defined and value is an object – display empty
                                    vVal = null;
                                }
                            }
                            return self._createSubTableCellControl(oColField, vVal, oSubTableLookups || {});
                        });
                        var oItem = new sap.m.ColumnListItem({ cells: aCells });
                        oItem.data("rowData", oRow);
                        oTable.addItem(oItem);
                    });
                },
                "error": function () {
                    // Silent fail – table stays empty, main form load is unaffected
                }
            });
        },
        _createSubTableCellControl: function (oColField, vVal, oSubTableLookups) {
            var sFieldKey = oColField.fieldName || oColField.name;
            var aLookupItems = oSubTableLookups && oSubTableLookups[sFieldKey];

            if (oColField.lookupListId && aLookupItems) {
                var oSelect = new sap.m.Select({ width: "100%", autoAdjustWidth: false });
                // Add a blank first item so nothing is pre-selected when value is absent
                oSelect.addItem(new sap.ui.core.Item({ key: "", text: "" }));
                aLookupItems.forEach(function (oLookupItem) {
                    // Key = LI_ID (raw integer stored in data); Text = Comments (display label)
                    var sKey = String(oLookupItem.LI_ID || oLookupItem.Value || "");
                    var sText = String(oLookupItem.Comments || oLookupItem.Value || oLookupItem.Name || "");
                    oSelect.addItem(new sap.ui.core.Item({ key: sKey, text: sText }));
                });
                if (vVal !== undefined && vVal !== null && vVal !== "") {
                    oSelect.setSelectedKey(String(vVal));
                }
                return oSelect;
            }

            var bIsDateField = oColField.fieldTypeId === 9 ||
                (typeof vVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(vVal));

            if (bIsDateField) {
                var oDatePicker = new sap.m.DatePicker({ displayFormat: "dd MMM yyyy" });
                if (vVal !== undefined && vVal !== null && vVal !== "") {
                    var oParsedDate = new Date(vVal);
                    if (!isNaN(oParsedDate.getTime())) {
                        oDatePicker.setDateValue(oParsedDate);
                    }
                }
                return oDatePicker;
            }

            return new sap.m.Input({
                value: (vVal !== undefined && vVal !== null) ? String(vVal) : "",
                type: oColField.fieldTypeId === 6 ? "Number" : "Text"
            });
        },
        _onSubTableAddRow: function (oTable) {
            var aVisibleFields = oTable.data("subTableFields") || [];
            var oSubTableLookups = oTable.data("subTableLookups") || {};
            var self = this;

            var aCells = aVisibleFields.map(function (oColField) {
                return self._createSubTableCellControl(oColField, null, oSubTableLookups);
            });

            var oNewItem = new sap.m.ColumnListItem({ cells: aCells });
            oNewItem.data("isNew", true);
            oTable.addItem(oNewItem);
        },
        _onSubTableDeleteRows: function (oTable, sCategoryName, sHash) {
            var aSelectedItems = oTable.getSelectedItems();
            if (!aSelectedItems.length) {
                MessageToast.show("Please select rows to delete");
                return;
            }
            var self = this;
            MessageBox.confirm("Delete the selected row(s)?", {
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) { return; }
                    aSelectedItems.forEach(function (oItem) {
                        var oRowData = oItem.data("rowData");
                        var bIsNew = oItem.data("isNew");
                        if (!bIsNew && oRowData && sCategoryName) {
                            // Find primary key: first *_ID field that is not Component_ID
                            var sPrimaryKey = null;
                            Object.keys(oRowData).forEach(function (sKey) {
                                if (!sPrimaryKey && sKey !== "Component_ID" &&
                                    (sKey === "id" || sKey === "ID" || /[_]ID$/i.test(sKey))) {
                                    sPrimaryKey = oRowData[sKey];
                                }
                            });
                            if (sPrimaryKey !== null && sPrimaryKey !== undefined) {
                                $.ajax({
                                    "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sCategoryName) + "/" + encodeURIComponent(sPrimaryKey) + "?hash=" + encodeURIComponent(sHash),
                                    "method": "DELETE",
                                    "error": function () {
                                        MessageToast.show("Error deleting row");
                                    }
                                });
                            }
                        }
                        oTable.removeItem(oItem);
                        oItem.destroy();
                    });
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
                    "url":  self.isRunninglocally()+"/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId),
                   "method": "GET",
                    "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId),
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
                        // Resolve display text for fields with nestedField.lookupListId
                        self._resolveNestedLookupFields(oRecord, sResolvedHash);
                        var sComponentId = oRecord && oRecord.Component_ID;
                        if (sComponentId) {
                            // Make validation POST call to check field visibility
                            self._validateFieldVisibility(sComponentId, oRecord, sResolvedHash, sTableName);
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
        _validateFieldVisibility: function (sComponentId, oRecord, sHash, sTableName) {
            var self = this;
            // Show busy indicator on dialog
            if (this._oFormDialog) {
                this._oFormDialog.setBusy(true);
            }
            $.ajax({
                "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sTableName) + "/validate/" + encodeURIComponent(sComponentId) + "?hash=" + encodeURIComponent(sHash),
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

            var self = this;
            var iVisibleFieldCount = 0;
            var fnSetFieldVisible = function (sFieldKey, bVisible) {
                var oTargets = self._fieldVisibilityMap && self._fieldVisibilityMap[sFieldKey];
                if (oTargets) {
                    if (oTargets.label) {
                        oTargets.label.setVisible(bVisible);
                    }
                    if (oTargets.container) {
                        oTargets.container.setVisible(bVisible);
                    }
                    return;
                }

                var oFallbackControl = self._fieldControlMap[sFieldKey];
                if (oFallbackControl) {
                    oFallbackControl.setVisible(bVisible);
                }
            };
            var fnIsFieldVisible = function (sFieldKey) {
                var oTargets = self._fieldVisibilityMap && self._fieldVisibilityMap[sFieldKey];
                if (oTargets) {
                    if (oTargets.container) {
                        return oTargets.container.getVisible();
                    }
                    if (oTargets.label) {
                        return oTargets.label.getVisible();
                    }
                }

                var oFallbackControl = self._fieldControlMap[sFieldKey];
                return !!(oFallbackControl && oFallbackControl.getVisible());
            };

            oFormData.fields.forEach(function (oField) {
                var sFieldKey = oField.fieldName || oField.name;
                var oControl = self._fieldControlMap[sFieldKey];
                var oVisibilityTargets = self._fieldVisibilityMap && self._fieldVisibilityMap[sFieldKey];

                if (!oControl && !oVisibilityTargets) {
                    return;
                }

                // Rule 1: If formVisible is false from metadata, field is HIDDEN
                if (oField.formVisible === false) {
                    fnSetFieldVisible(sFieldKey, false);
                    return;
                }

                // Rule 1b: Expanded BO fields (from foreign table) are governed by
                // gridVisible, not by the parent table's validation updateStates.
                // Keep them visible and skip the updateStates check.
                if (oField._businessObjectName) {
                    fnSetFieldVisible(sFieldKey, true);
                    iVisibleFieldCount++;
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
                        } else {
                            // visible property doesn't exist -> default to visible
                            bFieldVisible = true;
                        }
                    } else {
                        // Field NOT found in updateStates -> default to visible
                        bFieldVisible = true;
                    }
                } else {
                    // No updateStates in response -> default to visible
                    bFieldVisible = true;
                }

                fnSetFieldVisible(sFieldKey, bFieldVisible);
                if (bFieldVisible) {
                    iVisibleFieldCount++;
                }
            });

            // After all field visibilities are updated, hide tabs whose fields are all hidden
            if (this._categoryTabMap && oFormData.fields) {
                // Build a map of category -> whether any field in that category is visible
                var oCategoryVisibility = {};
                oFormData.fields.forEach(function (oField) {
                    var sCat = oField.category || (oFormData.categories && oFormData.categories[0] && oFormData.categories[0].name) || "General";
                    if (oCategoryVisibility[sCat] === undefined) {
                        oCategoryVisibility[sCat] = false;
                    }
                    var sFieldKey = oField.fieldName || oField.name;
                    if (fnIsFieldVisible(sFieldKey)) {
                        oCategoryVisibility[sCat] = true;
                    }
                });
                Object.keys(self._categoryTabMap).forEach(function (sCatName) {
                    var oTab = self._categoryTabMap[sCatName];
                    if (oTab) {
                        oTab.setVisible(oCategoryVisibility[sCatName] === true);
                    }
                });
            }

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

            // Re-apply colour backgrounds after SAPUI5 flushes its render queue
            // (setVisible above triggers re-render which wipes inline styles)
            var self = this;
            setTimeout(function () { self._reapplyColourSwatches(); }, 0);
        },
        _onFieldImageButtonPress: function (sFieldKey) {
            var oLocalDataModel = this.getLocalDataModel();
            var sComponentId = oLocalDataModel.getProperty("/sCompoonentID");
            var sTableName = this._formDataTableName;
            var sHash = oLocalDataModel.getProperty("/HashToken");
            var self = this;

            var fnFetch = function (sResolvedHash) {
                var sUrl = self.isRunninglocally() +
                    "/bo/" + encodeURIComponent(sTableName) +
                    "/" + encodeURIComponent(sComponentId) +
                    "/" + encodeURIComponent(sFieldKey) +
                    "?hash=" + encodeURIComponent(sResolvedHash) +
                    "&format=png";

                fetch(sUrl, {
                    headers: {
                        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
                    }
                })
                .then(function (oResponse) {
                    if (!oResponse.ok) {
                        MessageToast.show("Image not available");
                        return null;
                    }
                    return oResponse.blob();
                })
                .then(function (oBlob) {
                    if (!oBlob) { return; }
                    var sObjectUrl = URL.createObjectURL(oBlob);
                    self._showFieldImagePopup(sObjectUrl, sFieldKey);
                })
                .catch(function () {
                    MessageToast.show("Failed to load image");
                });
            };

            if (sHash) {
                fnFetch(sHash);
            } else {
                this.getoHashToken().done(function (oResult) {
                    if (oResult && oResult.hash) { fnFetch(oResult.hash); }
                });
            }
        },
        _onGlobalTableInfoPress: function (oField, oEvent) {
            var sFieldName = oField.name || oField.fieldName || "";
            // Use the Dynamic Form Dialog title (tile title) as the display value
            var sDialogTitle = this._oFormDialog && this._oFormDialog.getModel("FormData")
                ? (this._oFormDialog.getModel("FormData").getProperty("/title") || this._formDataTableName || "")
                : (this._formDataTableName || "");

            if (!this._oGlobalTableInfoDialog) {
                this._oGlobalTableInfoDialog = new sap.m.Dialog({
                    title: "Global Table Info",
                    type: "Message",
                    contentWidth: "20rem",
                    buttons: [
                        new sap.m.Button({
                            text: "Close",
                            press: function () {
                                this._oGlobalTableInfoDialog.close();
                            }.bind(this)
                        })
                    ]
                });
                this.getView().addDependent(this._oGlobalTableInfoDialog);
            }

            this._oGlobalTableInfoDialog.destroyContent();
            this._oGlobalTableInfoDialog.addContent(
                new VBox({
                    items: [
                        new Label({ text: "Table", design: "Bold" }),
                        new Text({ text: sDialogTitle }),
                        new Label({ text: "Field Name", design: "Bold" }).addStyleClass("sapUiSmallMarginTop"),
                        new Text({ text: sFieldName })
                    ]
                }).addStyleClass("sapUiSmallMargin")
            );
            this._oGlobalTableInfoDialog.open();
        },
        _showFieldImagePopup: function (sSrc, sTitle) {
            // Revoke previous object URL to avoid memory leaks
            if (this._fieldImageObjectUrl) {
                URL.revokeObjectURL(this._fieldImageObjectUrl);
            }
            this._fieldImageObjectUrl = sSrc;

            if (!this._oFieldImageDialog) {
                this._oFieldImageDialog = new sap.m.Dialog({
                    stretch: false,
                    resizable: true,
                    draggable: true,
                    contentWidth: "700px",
                    contentHeight: "600px",
                    afterClose: function () {
                        // Clean up object URL after dialog closes
                        if (this._fieldImageObjectUrl) {
                            URL.revokeObjectURL(this._fieldImageObjectUrl);
                            this._fieldImageObjectUrl = null;
                        }
                    }.bind(this),
                    buttons: [
                        new sap.m.Button({
                            text: "Close",
                            press: function () {
                                this._oFieldImageDialog.close();
                            }.bind(this)
                        })
                    ]
                });
                this.getView().addDependent(this._oFieldImageDialog);
            }

            // Update title and image each time
            this._oFieldImageDialog.setTitle(sTitle || "");
            this._oFieldImageDialog.destroyContent();
            this._oFieldImageDialog.addContent(
                new sap.m.Image({
                    src: sSrc,
                    width: "100%",
                    height: "100%",
                    densityAware: false
                })
            );
            this._oFieldImageDialog.open();
        },
        _reapplyColourSwatches: function () {
            var self = this;
            if (!this._colourInputMap || !this._colourValueMap) { return; }
            Object.keys(this._colourInputMap).forEach(function (sFieldKey) {
                var oInput = self._colourInputMap[sFieldKey];
                var sHex = self._colourValueMap[sFieldKey];
                if (!oInput || !sHex) { return; }
                oInput.setValue("");
                var oInner = oInput.getDomRef("inner");
                if (oInner) {
                    oInner.style.backgroundColor = sHex;
                    oInner.style.color = "#000000";
                    oInner.style.fontWeight = "bold";
                }
            });
        },

        /**
         * For a field's unitId, find the matching Unit by Unit_ID,
         * then find the Unit_Type by UT_ID to get the type info and reference symbol.
         * Returns { symbol, utId, refUnit, unitTypeName } or null.
         */
        _getUnitInfoForField: function (iUnitId) {
            if (!iUnitId) { return null; }
            var iId = Number(iUnitId);

            // Find the Unit record directly by Unit_ID
            var oMatchedUnit = null;
            for (var j = 0; j < this._aUnitData.length; j++) {
                if (Number(this._aUnitData[j].Unit_ID) === iId) {
                    oMatchedUnit = this._aUnitData[j];
                    break;
                }
            }

            // Find Unit_Type by UT_ID from the matched unit, or fall back to Ref_Unit_ID lookup
            var oUnitType = null;
            if (oMatchedUnit && oMatchedUnit.UT_ID) {
                var iUtId = Number(oMatchedUnit.UT_ID);
                for (var i = 0; i < this._aUnitTypeData.length; i++) {
                    if (Number(this._aUnitTypeData[i].UT_ID) === iUtId) {
                        oUnitType = this._aUnitTypeData[i];
                        break;
                    }
                }
            }
            if (!oUnitType) {
                // Fall back: find Unit_Type where Ref_Unit_ID === unitId
                for (var k = 0; k < this._aUnitTypeData.length; k++) {
                    if (Number(this._aUnitTypeData[k].Ref_Unit_ID) === iId) {
                        oUnitType = this._aUnitTypeData[k];
                        break;
                    }
                }
            }
            if (!oUnitType) { return null; }

            // Find the reference Unit for this type (Ref_Unit_ID from Unit_Type)
            var oRefUnit = null;
            var iRefUnitId = Number(oUnitType.Ref_Unit_ID);
            for (var m = 0; m < this._aUnitData.length; m++) {
                if (Number(this._aUnitData[m].Unit_ID) === iRefUnitId) {
                    oRefUnit = this._aUnitData[m];
                    break;
                }
            }

            return {
                symbol: oMatchedUnit ? oMatchedUnit.Symbol : (oRefUnit ? oRefUnit.Symbol : (oUnitType.Reference_Symbol || "")),
                utId: oUnitType.UT_ID,
                refUnit: oRefUnit,
                unitTypeName: oUnitType.Name
            };
        },

        /**
         * Get all units belonging to a UT_ID (unit type).
         */
        _getUnitsForType: function (iUtId) {
            var iId = Number(iUtId);
            return this._aUnitData.filter(function (oUnit) {
                return Number(oUnit.UT_ID) === iId;
            });
        },

        /**
         * Lazily build the UT_ID -> preferred Unit_ID map by cross-referencing
         * Unit_Item records (which only have Unit_ID) with /bo/Unit/ data (which has UT_ID).
         */
        _ensureUserPreferredUnitMap: function () {
            if (this._bUserPreferredMapBuilt) { return; }
            if (!this._aRawUnitItems || this._aRawUnitItems.length === 0 || this._aUnitData.length === 0) { return; }

            this._oUserPreferredUnitByType = {};
            var oMap = this._oUserPreferredUnitByType;
            var aUnitData = this._aUnitData;
            this._aRawUnitItems.forEach(function (oItem) {
                if (oItem.Unit_ID) {
                    var iUnitId = Number(oItem.Unit_ID);
                    var oUnit = aUnitData.find(function (oU) {
                        return Number(oU.Unit_ID) === iUnitId;
                    });
                    if (oUnit && oUnit.UT_ID) {
                        oMap[Number(oUnit.UT_ID)] = iUnitId;
                    }
                }
            });
            this._bUserPreferredMapBuilt = true;
        },

        /**
         * Handle unit symbol Link press: read the current field value,
         * calculate conversions for all units of that type, and show in a Popover.
         */
        _onUnitSymbolPress: function (sFieldKey, iUnitId, oEvent) {
            var oSource = oEvent.getSource();
            var oControl = this._fieldControlMap[sFieldKey];
            var self = this;
            var vFieldValue = 0;

            // Read current value from the form field
            if (oControl) {
                if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
                    vFieldValue = parseFloat(oControl.getValue()) || 0;
                } else if (oControl.isA("sap.m.Select")) {
                    vFieldValue = parseFloat(oControl.getSelectedKey()) || 0;
                }
            }

            var oUnitInfo = this._getUnitInfoForField(iUnitId);
            if (!oUnitInfo) {
                MessageToast.show("No unit information available");
                return;
            }

            // Get all units in this unit type
            var aUnits = this._getUnitsForType(oUnitInfo.utId);
            if (aUnits.length === 0) {
                MessageToast.show("No unit conversions available");
                return;
            }

            // Determine current unit gradient/constant to convert back to reference first
            var oCurrentInfo = this._unitFieldInfo[sFieldKey];
            var fCurrentGradient = (oCurrentInfo && oCurrentInfo.currentGradient) || 1;
            var fCurrentConstant = (oCurrentInfo && oCurrentInfo.currentConstant) || 0;
            // Convert field value back to reference unit value
            var vRefValue = (vFieldValue - fCurrentConstant) / fCurrentGradient;

            // Ensure preference map is built from Unit_Item + Unit cross-reference
            self._ensureUserPreferredUnitMap();
            // Check for user preferred unit for this unit type
            var iPreferredUnitId = self._oUserPreferredUnitByType
                ? self._oUserPreferredUnitByType[Number(oUnitInfo.utId)]
                : null;

            // For each target unit: converted = vRefValue * targetGradient + targetConstant
            var aConvertedItems = aUnits.map(function (oUnit) {
                var fGradient = parseFloat(oUnit.Gradient) || 1;
                var fConstant = parseFloat(oUnit.Constant) || 0;
                var fConverted = vRefValue * fGradient + fConstant;
                var iDecimals = (oUnit.Decimals !== undefined && oUnit.Decimals !== null) ? Number(oUnit.Decimals) : 5;
                var sConverted = fConverted.toFixed(iDecimals);
                return {
                    name: oUnit.Name,
                    symbol: oUnit.Symbol || "",
                    value: sConverted,
                    gradient: fGradient,
                    constant: fConstant,
                    unitId: oUnit.Unit_ID,
                    isPreferred: iPreferredUnitId !== null && iPreferredUnitId !== undefined && Number(oUnit.Unit_ID) === Number(iPreferredUnitId)
                };
            });

            // Sort preferred unit to top
            aConvertedItems.sort(function (a, b) {
                if (a.isPreferred && !b.isPreferred) { return -1; }
                if (!a.isPreferred && b.isPreferred) { return 1; }
                return 0;
            });

            // Determine which unit is the reference (default) unit
            var iRefUnitId = oUnitInfo.refUnit ? Number(oUnitInfo.refUnit.Unit_ID) : null;

            // Build and open Popover with unit conversions using DisplayListItem
            var oList = new List({
                mode: "SingleSelectMaster",
                items: aConvertedItems.map(function (oItem) {
                    var bIsDefault = iRefUnitId !== null && Number(oItem.unitId) === iRefUnitId;
                    var bIsCurrent = oItem.symbol === (oCurrentInfo && oCurrentInfo.currentSymbol);
                    var sLabel = oItem.name + " (" + oItem.symbol + ")";
                    if (bIsDefault) { sLabel += "  ·  Default"; }
                    var oListItem = new DisplayListItem({
                        label: sLabel,
                        value: oItem.value + " " + oItem.symbol,
                        type: "Active",
                        selected: bIsCurrent
                    });
                    if (bIsDefault) { oListItem.addStyleClass("uomDefaultItem"); }
                    if (bIsCurrent) { oListItem.addStyleClass("uomCurrentItem"); }
                    oListItem.data("unitSymbol", oItem.symbol);
                    oListItem.data("unitValue", oItem.value);
                    oListItem.data("unitGradient", oItem.gradient);
                    oListItem.data("unitConstant", oItem.constant);
                    return oListItem;
                }),
                selectionChange: function (oSelEvent) {
                    var oSelectedItem = oSelEvent.getParameter("listItem");
                    if (!oSelectedItem) { return; }

                    var sNewValue = oSelectedItem.data("unitValue");
                    var sNewSymbol = oSelectedItem.data("unitSymbol");
                    var fNewGradient = oSelectedItem.data("unitGradient");
                    var fNewConstant = oSelectedItem.data("unitConstant");

                    // Update the input field with the converted value
                    if (oControl) {
                        if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
                            oControl.setValue(sNewValue);
                        } else if (oControl.isA("sap.m.Select")) {
                            oControl.setSelectedKey(sNewValue);
                        }
                    }

                    // Update the unit link text to the selected unit symbol
                    var oUnitLink = self._unitLinkMap[sFieldKey];
                    if (oUnitLink) {
                        oUnitLink.setText(sNewSymbol);
                    }

                    // Store current unit gradient/constant so next conversion is correct
                    if (self._unitFieldInfo[sFieldKey]) {
                        self._unitFieldInfo[sFieldKey].currentSymbol = sNewSymbol;
                        self._unitFieldInfo[sFieldKey].currentGradient = fNewGradient;
                        self._unitFieldInfo[sFieldKey].currentConstant = fNewConstant;
                    }

                    // Close the popover after selection
                    if (self._oUnitPopover) {
                        self._oUnitPopover.close();
                    }
                }
            });

            // Destroy previous popover if it exists
            if (this._oUnitPopover) {
                this._oUnitPopover.destroy();
                this._oUnitPopover = null;
            }

            // Build info toolbar showing Default and Preferred values
            var aInfoContent = [];

            // Default (reference) unit value
            if (oUnitInfo.refUnit) {
                var sRefSymbol = oUnitInfo.refUnit.Symbol || oUnitInfo.refUnit.Name || "";
                var iRefDecimals = (oUnitInfo.refUnit.Decimals !== undefined && oUnitInfo.refUnit.Decimals !== null) ? Number(oUnitInfo.refUnit.Decimals) : 5;
                var sRefFormatted = vRefValue.toFixed(iRefDecimals);
                aInfoContent.push(new sap.m.Label({ text: "Default:", design: "Bold" }));
                aInfoContent.push(new sap.m.Text({ text: sRefFormatted + " " + sRefSymbol }));
            }

            // Preferred unit value
            var oPreferredItem = iPreferredUnitId !== null && iPreferredUnitId !== undefined
                ? aConvertedItems.find(function (o) { return o.isPreferred; })
                : null;
            if (oPreferredItem) {
                aInfoContent.push(new sap.m.ToolbarSpacer());
                aInfoContent.push(new sap.m.Label({ text: "Preferred:", design: "Bold" }));
                aInfoContent.push(new sap.m.Text({ text: oPreferredItem.value + " " + oPreferredItem.symbol }));
            }

            var aPopoverContent = [];
            if (aInfoContent.length > 0) {
                var oInfoBar = new sap.m.Toolbar({ content: aInfoContent });
                oInfoBar.addStyleClass("uomPopoverInfoBar");
                aPopoverContent.push(oInfoBar);
            }
            aPopoverContent.push(oList);

            this._oUnitPopover = new Popover({
                title: oUnitInfo.unitTypeName || "Unit Conversions",
                contentWidth: "360px",
                placement: "Bottom",
                showHeader: true,
                content: aPopoverContent
            });
            this._oUnitPopover.addStyleClass("uomConversionPopover");

            this._oUnitPopover.openBy(oSource);
        },
        _checkPermissions: function (sProductValue, sHash) {
            var self = this;
            $.ajax({
                "url": self.isRunninglocally() + "/bo/Lookup_Item/" + encodeURIComponent(sProductValue),
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
        _tcolorToCssHex: function (tcolor) {
            if (isNaN(tcolor) || tcolor < 0) { return null; }
            var v = tcolor >>> 0;
            var r = v & 0xFF;
            var g = (v >>> 8) & 0xFF;
            var b = (v >>> 16) & 0xFF;
            return "#" + [r, g, b].map(function (n) { return n.toString(16).padStart(2, "0"); }).join("").toUpperCase();
        },
        _populateLinkedFields: function (oLinkedResponse, sBusinessObjectName) {
            if (!oLinkedResponse || !this._fieldControlMap) { return; }
            var aRows = this._linkedDataByBO[sBusinessObjectName] || [];
            if (aRows.length === 0) { return; }

            var self = this;
            var oBoMap = this._fieldBusinessObjectMap || {};

            // Collect ordered Select field keys belonging to this BO
            var aSelectFields = [];
            var aNonSelectFields = [];
            Object.keys(this._fieldControlMap).forEach(function (sFieldKey) {
                if (oBoMap[sFieldKey] !== sBusinessObjectName) { return; }
                var oControl = self._fieldControlMap[sFieldKey];
                if (oControl && oControl.isA("sap.m.Select")) {
                    aSelectFields.push(sFieldKey);
                } else {
                    aNonSelectFields.push(sFieldKey);
                }
            });

            // Build cascade order using form order with independent chain detection
            // E.g. Asset_Type → Generic_Material → Spec_and_Grade → Product_Form → Condition
            //       Nps → Schedule (independent chain)
            var aCascadeOrder = this._buildCascadeOrder(aSelectFields, aRows);
            this._cascadeFieldOrder[sBusinessObjectName] = aCascadeOrder;

            // Build chain index: field → chain index (for cross-chain boundary checks)
            var aChains = aCascadeOrder._chains || [aCascadeOrder.slice()];
            this._cascadeChainIndex = this._cascadeChainIndex || {};
            var oChainIndex = {};
            aChains.forEach(function (aChain, iChainIdx) {
                aChain.forEach(function (sField) {
                    oChainIndex[sField] = iChainIdx;
                });
            });
            this._cascadeChainIndex[sBusinessObjectName] = oChainIndex;

            // Populate root of each independent chain with all unique values
            aChains.forEach(function (aChain) {
                if (aChain.length > 0) {
                    self._populateSelectUnique(aChain[0], aRows);
                }
            });

            // Find the matching row based on the parent record's link value
            var oMatchInfo = this._linkedFieldMatchInfo && this._linkedFieldMatchInfo[sBusinessObjectName];
            var oMatchedRow = null;
            if (oMatchInfo && oMatchInfo.filterField && oMatchInfo.linkValue !== undefined) {
                oMatchedRow = aRows.find(function(oRow) {
                    return String(oRow[oMatchInfo.filterField]) === String(oMatchInfo.linkValue);
                });
            }
            var oFirstRow = oMatchedRow || aRows[0];
            for (var i = 0; i < aCascadeOrder.length; i++) {
                var sField = aCascadeOrder[i];
                var oControl = this._fieldControlMap[sField];
                var vValue = oFirstRow[sField];
                if (oControl && vValue !== undefined && vValue !== null) {
                    // For non-root fields, filter rows by all ancestor selections first
                    if (i > 0) {
                        var aFiltered = this._getFilteredRows(sBusinessObjectName, aCascadeOrder, i);
                        this._populateSelectUnique(sField, aFiltered);
                    }
                    var sValueStr = String(vValue).trim();
                    this._setSelectValue(oControl, sValueStr);
                }
            }

            // Populate non-Select fields from first row
            aNonSelectFields.forEach(function (sFieldKey) {
                var oControl = self._fieldControlMap[sFieldKey];
                var vValue = oFirstRow[sFieldKey];
                if (vValue === undefined || vValue === null) { return; }
                if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
                    oControl.setValue(String(vValue));
                } else if (oControl.isA("sap.m.DatePicker")) {
                    var oDate = new Date(vValue);
                    if (!isNaN(oDate.getTime())) { oControl.setDateValue(oDate); } else { oControl.setValue(String(vValue)); }
                } else if (oControl.isA("sap.m.CheckBox")) {
                    oControl.setSelected(!!vValue);
                }
            });

            // Attach cascade change handlers to each Select in the chain
            for (var j = 0; j < aCascadeOrder.length; j++) {
                (function (iIdx) {
                    var sField = aCascadeOrder[iIdx];
                    var oCtrl = self._fieldControlMap[sField];
                    if (oCtrl && oCtrl.isA("sap.m.Select")) {
                        oCtrl.attachChange(function () {
                            self._onCascadeSelectChange(sBusinessObjectName, aCascadeOrder, iIdx);
                        });
                    }
                })(j);
            }
        },

        /**
         * Build cascade order using form order (fields are already sorted by formOrder
         * from buildFormContent). Separate independent chains by checking correlation:
         * two fields are in the same chain if filtering by one affects the other's
         * available values.
         * E.g. Asset_Type → Generic_Material → Spec_and_Grade → Product_Form → Condition
         *      Nps → Schedule (independent chain)
         */
        _buildCascadeOrder: function (aSelectFields, aRows) {
            if (aSelectFields.length <= 1) { return aSelectFields.slice(); }

            // Collect total unique values per field
            var oAllUnique = {};
            aSelectFields.forEach(function (sField) {
                var oSeen = {};
                aRows.forEach(function (oRow) {
                    var v = oRow[sField];
                    if (v !== undefined && v !== null && v !== "") {
                        oSeen[String(v)] = true;
                    }
                });
                oAllUnique[sField] = Object.keys(oSeen).length;
            });

            // Check if filtering by fieldA reduces the unique values of fieldB
            function influences(sA, sB) {
                var iBTotal = oAllUnique[sB];
                if (iBTotal <= 1) { return false; }
                var oGroupedByA = {};
                aRows.forEach(function (oRow) {
                    var vA = oRow[sA], vB = oRow[sB];
                    if (vA == null || vA === "" || vB == null || vB === "") { return; }
                    var sAVal = String(vA);
                    if (!oGroupedByA[sAVal]) { oGroupedByA[sAVal] = {}; }
                    oGroupedByA[sAVal][String(vB)] = true;
                });
                var aGroups = Object.keys(oGroupedByA);
                for (var i = 0; i < aGroups.length; i++) {
                    if (Object.keys(oGroupedByA[aGroups[i]]).length < iBTotal) {
                        return true;
                    }
                }
                return false;
            }

            // Group into independent chains: consecutive correlated fields
            var aChains = [[aSelectFields[0]]];
            for (var i = 1; i < aSelectFields.length; i++) {
                var sCur = aSelectFields[i];
                var aChain = aChains[aChains.length - 1];
                var bCorrelated = false;
                for (var j = 0; j < aChain.length; j++) {
                    if (influences(aChain[j], sCur) || influences(sCur, aChain[j])) {
                        bCorrelated = true;
                        break;
                    }
                }
                if (bCorrelated) {
                    aChain.push(sCur);
                } else {
                    aChains.push([sCur]);
                }
            }

            // Flatten chains maintaining form order within each
            var aResult = [];
            aChains.forEach(function (aChain) {
                aResult = aResult.concat(aChain);
            });

            // Attach chain boundaries so consumers can respect independent chains
            aResult._chains = aChains;
            return aResult;
        },

        /**
         * Populate a Select control with unique values from given rows.
         */
        _populateSelectUnique: function (sFieldKey, aRows) {
            var oControl = this._fieldControlMap[sFieldKey];
            if (!oControl || !oControl.isA("sap.m.Select")) { return; }
            var aUniqueValues = [];
            var oSeen = {};
            aRows.forEach(function (oRow) {
                var vVal = oRow[sFieldKey];
                if (vVal !== undefined && vVal !== null && vVal !== "") {
                    var sVal = String(vVal);
                    if (!oSeen[sVal]) {
                        oSeen[sVal] = true;
                        aUniqueValues.push(sVal);
                    }
                }
            });
            oControl.removeAllItems();
            aUniqueValues.forEach(function (sVal) {
                oControl.addItem(new Item({ key: sVal, text: sVal }));
            });
        },

        /**
         * Set a Select control's selected value by key or text match.
         */
        _setSelectValue: function (oControl, sValue) {
            var aItems = oControl.getItems();
            for (var i = 0; i < aItems.length; i++) {
                if (aItems[i].getKey() === sValue || aItems[i].getText() === sValue) {
                    oControl.setSelectedItem(aItems[i]);
                    return;
                }
            }
            if (aItems.length > 0) {
                oControl.setSelectedItem(aItems[0]);
            }
        },

        /**
         * Get rows filtered by ancestor Select values in the same chain up to (but not including) iFieldIdx.
         */
        _getFilteredRows: function (sBusinessObjectName, aCascadeOrder, iFieldIdx) {
            var aAllRows = this._linkedDataByBO[sBusinessObjectName] || [];
            var aFiltered = aAllRows;
            var oChainIndex = this._cascadeChainIndex && this._cascadeChainIndex[sBusinessObjectName];
            var sTargetField = aCascadeOrder[iFieldIdx];
            var iTargetChain = oChainIndex ? oChainIndex[sTargetField] : undefined;

            for (var i = 0; i < iFieldIdx; i++) {
                var sAncestor = aCascadeOrder[i];
                // Skip ancestors from different independent chains
                if (oChainIndex && iTargetChain !== undefined && oChainIndex[sAncestor] !== iTargetChain) {
                    continue;
                }
                var oAncestorCtrl = this._fieldControlMap[sAncestor];
                if (oAncestorCtrl && oAncestorCtrl.isA("sap.m.Select")) {
                    var sSelectedKey = oAncestorCtrl.getSelectedKey();
                    if (sSelectedKey) {
                        aFiltered = aFiltered.filter(function (oRow) {
                            return String(oRow[sAncestor] || "") === sSelectedKey;
                        });
                    }
                }
            }
            return aFiltered;
        },

        /**
         * Handle cascade Select change: clear and repopulate child Selects in the same chain.
         */
        _onCascadeSelectChange: function (sBusinessObjectName, aCascadeOrder, iChangedIdx) {
            var oChainIndex = this._cascadeChainIndex && this._cascadeChainIndex[sBusinessObjectName];
            var sChangedField = aCascadeOrder[iChangedIdx];
            var iChangedChain = oChainIndex ? oChainIndex[sChangedField] : undefined;

            // For each child field after the changed one in the same chain, repopulate
            for (var i = iChangedIdx + 1; i < aCascadeOrder.length; i++) {
                var sChildField = aCascadeOrder[i];
                // Skip fields from different independent chains
                if (oChainIndex && iChangedChain !== undefined && oChainIndex[sChildField] !== iChangedChain) {
                    continue;
                }
                var oChildCtrl = this._fieldControlMap[sChildField];
                if (!oChildCtrl || !oChildCtrl.isA("sap.m.Select")) { continue; }

                // Filter rows by all ancestors up to this child
                var aFiltered = this._getFilteredRows(sBusinessObjectName, aCascadeOrder, i);
                this._populateSelectUnique(sChildField, aFiltered);

                // Auto-select first item
                var aItems = oChildCtrl.getItems();
                if (aItems.length > 0) {
                    oChildCtrl.setSelectedItem(aItems[0]);
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

                if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
                    var sDisplayValue = String(vValue);
                    if (typeof vValue === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(vValue)) {
                        var oParsedDate = new Date(vValue);
                        if (!isNaN(oParsedDate.getTime())) {
                            var aMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                            sDisplayValue = oParsedDate.getUTCDate() + " " + aMonths[oParsedDate.getUTCMonth()] + " " + oParsedDate.getUTCFullYear();
                        }
                    }
                    // Convert value to preferred unit if a preferred unit conversion exists,
                    // and always apply the unit's Decimals formatting when a unit is present
                    var oUnitFieldInfo = self._unitFieldInfo && self._unitFieldInfo[sFieldKey];
                    if (oUnitFieldInfo) {
                        var fRawValue = parseFloat(vValue);
                        if (!isNaN(fRawValue)) {
                            var fGradient = oUnitFieldInfo.currentGradient || 1;
                            var fConstant = oUnitFieldInfo.currentConstant || 0;
                            var fConverted = fRawValue * fGradient + fConstant;
                            // Get decimals from the current (preferred or default) unit
                            var oDisplayUnit = self._aUnitData && self._aUnitData.find(function (oU) {
                                return oU.Symbol === oUnitFieldInfo.currentSymbol;
                            });
                            var iDecimals = (oDisplayUnit && oDisplayUnit.Decimals !== undefined && oDisplayUnit.Decimals !== null)
                                ? Number(oDisplayUnit.Decimals) : 5;
                            sDisplayValue = fConverted.toFixed(iDecimals);
                        }
                    }
                    oControl.setValue(sDisplayValue);
                    if (self._colourInputMap && self._colourInputMap[sFieldKey] && oControl.isA("sap.m.Input")) {
                        var sHex = self._tcolorToCssHex(Number(vValue));
                        if (sHex) {
                            oControl.setValue("");
                            self._colourValueMap[sFieldKey] = sHex;
                            var oInner = oControl.getDomRef("inner");
                            if (oInner) {
                                oInner.style.backgroundColor = sHex;
                                oInner.style.color = "#000000";
                                oInner.style.fontWeight = "bold";
                            } else {
                                oControl.addEventDelegate({
                                    onAfterRendering: function () {
                                        var oDomInner = oControl.getDomRef("inner");
                                        if (oDomInner) {
                                            oDomInner.style.backgroundColor = sHex;
                                            oDomInner.style.color = "#000000";
                                            oDomInner.style.fontWeight = "bold";
                                        }
                                    }
                                });
                            }
                        }
                    }
                } else if (oControl.isA("sap.m.DatePicker")) {
                    var oDate = new Date(vValue);
                    if (!isNaN(oDate.getTime())) {
                        oControl.setDateValue(oDate);
                    } else {
                        oControl.setValue(String(vValue));
                    }
                } else if (oControl.isA("sap.m.CheckBox")) {
                    oControl.setSelected(!!vValue);
                } else if (oControl.isA("sap.m.Select") || oControl.isA("sap.m.ComboBox")) {
                    var sValueStr = String(vValue).trim();

                    // Store this value as pending - it will be applied after items load
                    self._pendingComboBoxValues[sFieldKey] = {
                        control: oControl,
                        value: sValueStr
                    };

                    // Get all items in the select
                    var aItems = oControl.getItems();

                    if (aItems && aItems.length > 0) {
                        // Items already loaded, apply immediately
                        self._applyComboBoxValue(oControl, sFieldKey, sValueStr);
                    } else {
                        // Items not loaded yet - they will be applied when _applyPendingComboBoxValues is called
                    }
                } else if (oControl.isA("sap.m.Table")) {
                    // Data is populated by _loadSubTableData – skip, do not overwrite
                    return;
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

        onOpenNexuslink: function () {
            var oLocalDataModel = this.getLocalDataModel();
            var oSelectedNode = oLocalDataModel.getProperty("/selectedNodeData");

            if (!oSelectedNode || !oSelectedNode.VN_ID) {
                MessageToast.show(this.getResourceBundle().getText("msgNoAssetSelected"));
                return;
            }

            var sVnId = oSelectedNode.VN_ID;
            var sAigData = oLocalDataModel.getProperty("/selectedTableData");
            var sAigId = sAigData && sAigData.key ? sAigData.key : "";

            var sUrl = "https://trial.nexusic.com/?navigateTo=Asset&searchKey=VN_ID&searchValue=" + encodeURIComponent(sVnId) + "&tab=AIG&aigId=" + encodeURIComponent(sAigId);
            window.open(sUrl, "_blank");
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

                        if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
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

            if (!aItems || aItems.length === 0) {
                return;
            }

            // Normalize the value for comparison
            var sNormalizedValue = String(sValue).trim();

            // Priority 1: Try to match by display text (Value field from lookup) since that's what gets stored
            var matchedKey = null;
            for (var i = 0; i < aItems.length; i++) {
                var sItemText = String(aItems[i].getText()).trim();

                // Try text match first (this is what the database stores)
                if (sItemText === sNormalizedValue) {
                    matchedKey = aItems[i].getKey();
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
                        break;
                    }
                }
            }

            if (matchedKey !== null) {
                oSelect.setSelectedKey(matchedKey);
            }
        },

        _applyPendingComboBoxValues: function () {
            if (!this._pendingComboBoxValues || Object.keys(this._pendingComboBoxValues).length === 0) {
                return;
            }

            var self = this;
            Object.keys(this._pendingComboBoxValues).forEach(function (sFieldKey) {
                var oPending = self._pendingComboBoxValues[sFieldKey];
                self._applyComboBoxValue(oPending.control, sFieldKey, oPending.value);
            });
            // Clear pending values after applying
            this._pendingComboBoxValues = {};
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
                // Navigate to the tab containing the first invalid field
                var sFirstInvalidField = aValidationErrors[0].field;
                var oSaveFormData = self._oFormDialog.getModel("FormData").getProperty("/formData");
                if (oSaveFormData && oSaveFormData.fields) {
                    var oInvalidField = oSaveFormData.fields.find(function (f) {
                        return (f.fieldName || f.name) === sFirstInvalidField;
                    });
                    if (oInvalidField) {
                        var sCat = oInvalidField.category ||
                            (oSaveFormData.categories && oSaveFormData.categories[0] && oSaveFormData.categories[0].name) ||
                            "General";
                        var oTargetTab = self._categoryTabMap && self._categoryTabMap[sCat];
                        if (oTargetTab) {
                            var oTabBar = self._oFormDialog.getContent()[0];
                            oTabBar.setSelectedKey(oTargetTab.getKey());
                        }
                    }
                }
                MessageToast.show(self.getResourceBundle().getText("msgFieldsRequireAttention", [aValidationErrors.length]));
                return;
            }
            // Collect form field values from _fieldControlMap (only non-empty values)
            var oPayload = {};
            if (this._fieldControlMap) {
                Object.keys(this._fieldControlMap).forEach(function (sFieldKey) {
                    var oControl = self._fieldControlMap[sFieldKey];
                    var vValue;
                    if (oControl.isA("sap.m.Input") || oControl.isA("sap.m.TextArea")) {
                        vValue = oControl.getValue();
                        if (vValue !== "" && vValue !== undefined) {
                            // Convert UOM fields back to default (reference) unit before saving
                            var oUnitMeta = self._unitFieldInfo && self._unitFieldInfo[sFieldKey];
                            if (oUnitMeta && (oUnitMeta.currentGradient !== 1 || oUnitMeta.currentConstant !== 0)) {
                                var fDisplayed = parseFloat(vValue);
                                if (!isNaN(fDisplayed)) {
                                    // Reverse: refValue = (displayedValue - constant) / gradient
                                    var fRefValue = (fDisplayed - oUnitMeta.currentConstant) / oUnitMeta.currentGradient;
                                    oPayload[sFieldKey] = String(fRefValue);
                                } else {
                                    oPayload[sFieldKey] = vValue;
                                }
                            } else {
                                oPayload[sFieldKey] = vValue;
                            }
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

                        // Post the selected text/value (not the LI_ID) - this is what the database expects
                        if (sSelectedText !== "" && sSelectedText !== undefined) {
                            oPayload[sFieldKey] = sSelectedText;
                        } else if (sSelectedKey !== "" && sSelectedKey !== undefined) {
                            oPayload[sFieldKey] = sSelectedKey;
                        }
                    } else if (oControl.isA("sap.m.ComboBox")) {
                        // ComboBox is editable — prefer selected item text, fall back to typed value
                        var oComboItem = oControl.getSelectedItem();
                        var sComboValue = oComboItem ? oComboItem.getText() : oControl.getValue();
                        if (sComboValue !== "" && sComboValue !== undefined) {
                            oPayload[sFieldKey] = sComboValue;
                        }
                    }
                });
            }
            self.setBusyOn();
            var fnPostData = function (sResolvedHash) {
                self.setBusyOn();
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sTableName) + "/" + encodeURIComponent(sComponentId) + "?hash=" + encodeURIComponent(sResolvedHash),
                    "method": "POST",
                    "contentType": "application/json",
                    "dataType": "json",
                    "data": JSON.stringify(oPayload),
                    "success": function () {
                        // Save any new sub-table rows added during this form session
                        if (self._subTableControls && self._subTableControls.length) {
                            self._subTableControls.forEach(function (oSubTable) {
                                var sSubCatName = oSubTable.data("subTableName");
                                var aAllItems = oSubTable.getItems();
                                if (!sSubCatName || !aAllItems.length) { return; }
                                var aSubVisibleFields = oSubTable.data("subTableFields") || [];

                                aAllItems.forEach(function (oRowItem) {
                                    var bIsNew = oRowItem.data("isNew") === true;
                                    var oRowData = oRowItem.data("rowData");
                                    var aCells = oRowItem.getCells();

                                    // Build payload from current cell values
                                    var oRowPayload = { Component_ID: sComponentId };
                                    aCells.forEach(function (oCell, iIdx) {
                                        var oColField = aSubVisibleFields[iIdx];
                                        if (!oColField) { return; }
                                        var sCellKey = oColField.fieldName || oColField.name;
                                        var vCellValue;
                                        if (oCell.isA("sap.m.Select")) {
                                            vCellValue = oCell.getSelectedKey();
                                        } else if (oCell.isA("sap.m.DatePicker")) {
                                            var oCellDate = oCell.getDateValue();
                                            if (oCellDate) {
                                                var sCellYear = oCellDate.getFullYear();
                                                var sCellMonth = String(oCellDate.getMonth() + 1).padStart(2, "0");
                                                var sCellDay = String(oCellDate.getDate()).padStart(2, "0");
                                                vCellValue = sCellYear + "-" + sCellMonth + "-" + sCellDay;
                                            }
                                        } else if (oCell.isA("sap.m.Input")) {
                                            vCellValue = oCell.getValue();
                                        }
                                        if (vCellValue !== "" && vCellValue !== undefined && vCellValue !== null) {
                                            oRowPayload[sCellKey] = vCellValue;
                                        }
                                    });

                                    if (bIsNew) {
                                        // New row – PUT to /bo/{tableName}/0?hash=... (id=0 signals record creation)
                                        $.ajax({
                                            "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sSubCatName) + "/0?hash=" + encodeURIComponent(sResolvedHash),
                                            "method": "PUT",
                                            "contentType": "application/json",
                                            "dataType": "json",
                                            "data": JSON.stringify(oRowPayload),
                                            "success": function (oResponse) {
                                                oRowItem.data("isNew", false);
                                                if (oResponse) { oRowItem.data("rowData", oResponse); }
                                            },
                                            "error": function () {
                                                MessageToast.show(self.getResourceBundle().getText("msgErrorSavingFormData"));
                                            }
                                        });
                                    } else if (oRowData) {
                                        // Existing row – find primary key (first *_ID field that is not Component_ID)
                                        var sRowId = null;
                                        Object.keys(oRowData).forEach(function (sKey) {
                                            if (!sRowId && sKey !== "Component_ID" &&
                                                (sKey === "id" || sKey === "ID" || /[_]ID$/i.test(sKey))) {
                                                sRowId = oRowData[sKey];
                                            }
                                        });
                                        if (sRowId !== null && sRowId !== undefined) {
                                            // POST to /bo/{tableName}/{rowId} to update existing row
                                            $.ajax({
                                                "url": self.isRunninglocally() + "/bo/" + encodeURIComponent(sSubCatName) + "/" + encodeURIComponent(sRowId) + "?hash=" + encodeURIComponent(sResolvedHash),
                                                "method": "POST",
                                                "contentType": "application/json",
                                                "dataType": "json",
                                                "data": JSON.stringify(oRowPayload),
                                                "success": function (oResponse) {
                                                    if (oResponse) { oRowItem.data("rowData", oResponse); }
                                                },
                                                "error": function () {
                                                    MessageToast.show(self.getResourceBundle().getText("msgErrorSavingFormData"));
                                                }
                                            });
                                        }
                                    }
                                });
                            });
                        }
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
            var sUrl = "https://trial.nexusic.com/?navigateTo=Asset&searchKey=VN_ID&searchValue=" + encodeURIComponent(oSelectedNode.VN_ID) + "&tab=Dashboard&dashboardId=" + sDashboardId;
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