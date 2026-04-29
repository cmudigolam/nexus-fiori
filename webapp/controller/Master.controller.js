sap.ui.define([
    "com/nexus/asset/controller/BaseController",
    "sap/m/MessageBox"
], (BaseController, MessageBox) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Master", {
        onInit() {

            var self = this;
            // $.ajax({
            //     "url": self.isRunninglocally() + "/nexus/health",
            //     "method": "GET",
            //     "dataType": "json",
            //     "success": function (response) {
            //         MessageBox.success("Health check passed: " + response.status);
            //     },
            //     "error": function () {
            //         MessageBox.error("Unhealthy");
            //     }
            // });



            this.setBusyOn();
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.getRoute("Master").attachPatternMatched(this.onRouteMatched, this);
            }
            this._masterSessionState = null;
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
            if (this._fnResizeHandler) {
                window.removeEventListener("resize", this._fnResizeHandler);
                this._fnResizeHandler = null;
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
            this._adjustTreeTableRows();
            if (!this._fnResizeHandler) {
                this._fnResizeHandler = this._adjustTreeTableRows.bind(this);
                window.addEventListener("resize", this._fnResizeHandler);
            }
        },

        _adjustTreeTableRows: function () {
            var oTable = this.byId("TreeTableBasic");
            if (!oTable) return;
            var oTableDom = oTable.getDomRef();
            // Estimate available height: window height minus table's top offset minus some padding for footer/margins
            var iTopOffset = oTableDom ? oTableDom.getBoundingClientRect().top : 200;
            var iAvailable = window.innerHeight - iTopOffset - 40;
            // Each row is ~33px (compact mode default row height)
            var iRowHeight = 33;
            // Subtract header row height (~33px)
            var iRows = Math.max(5, Math.floor((iAvailable - iRowHeight) / iRowHeight));
            this.getLocalDataModel().setProperty("/treeTableVisibleRows", iRows);
        },
        onRouteMatched: function () {
            this.setBusyOn();
            this._masterSessionState = null;
            this.getLocalDataModel().setProperty("/treeTable", []);
            this.getLocalDataModel().setProperty("/treeTableNoDataText", this.getResourceBundle().getText("msgSelectAssetToView"));
            // Calculate initial visible rows based on window height
            var iRows = Math.max(5, Math.floor((window.innerHeight - 240) / 33));
            this.getLocalDataModel().setProperty("/treeTableVisibleRows", iRows);
            this.getLocalDataModel().setProperty("/trafficLightColumnVisible", false);
            this.getLocalDataModel().setProperty("/trafficLightVersion", 0);
            this.getLocalDataModel().setProperty("/trafficLightFooterVisible", false);
            this._trafficLightColorMap = null;
            this._compTypeMap = {};
            var self = this;
            this.getoHashToken().done(function (result) {
                this.hash = result.hash;
                self.loadSessionState(this.hash, "Tree", "Asset Location").always(function (aSettings) {
                    self._masterSessionState = self._parseMasterSessionState(aSettings);
                    // Load Traffic Light (Comp_Overlay) list
                    self._loadTrafficLightList(self.hash);
                    // Fetch Comp_Type to build CT_ID -> Name map
                    $.ajax({
                        "url":  self.isRunninglocally()+ "/bo/Comp_Type/?pageSize=999",
                        "method": "GET",
                        "dataType": "json",
                        "data": {
                            "hash": self.hash
                        },
                        "success": function (response) {
                            var aCompTypes = Array.isArray(response && response.rows) ? response.rows : [];
                            aCompTypes.forEach(function (oType) {
                                if (oType.CT_ID !== undefined && oType.CT_ID !== null) {
                                    // Convert CT_ID to string to ensure consistency with row CT_ID values
                                    var sCtId = String(oType.CT_ID);
                                    // Store the name or generate a display value from Type_Description if available
                                    var sName = oType.Name || oType.Type_Description || oType.Description || oType.TypeName || "";
                                    self._compTypeMap[sCtId] = sName;
                                }
                            });
                            self._loadCompView();
                        },
                        "error": function () {
                            // Continue loading even if Comp_Type fails
                            self._loadCompView();
                        }
                    });
                });
            }.bind(this));
        },

        _loadTrafficLightList: function (sHash) {
            var self = this;
            $.ajax({
                "url": self.isRunninglocally() + "/bo/Comp_Overlay/",
                "method": "GET",
                "dataType": "json",
                "data": { "hash": sHash },
                "success": function (response) {
                    var aList = Array.isArray(response && response.rows) ? response.rows : [];
                    // Sort alphabetically by Name (case-insensitive) before prepending empty entry
                    aList.sort(function (a, b) {
                        var sA = String(a.Name || "").toLowerCase();
                        var sB = String(b.Name || "").toLowerCase();
                        return sA < sB ? -1 : sA > sB ? 1 : 0;
                    });
                    // Prepend an empty record so selecting it hides the T column and footer
                    aList = [{ CO_ID: "", Name: "" }].concat(aList);
                    var sSavedTrafficLight = self._masterSessionState && self._masterSessionState.trafficLight;
                    var sRestoredTrafficLight = "";
                    if (sSavedTrafficLight && sSavedTrafficLight !== "-1") {
                        var oMatch = aList.find(function (oItem) {
                            return String(oItem.CO_ID) === String(sSavedTrafficLight);
                        });
                        if (oMatch) {
                            sRestoredTrafficLight = String(oMatch.CO_ID);
                        }
                    }
                    self.getLocalDataModel().setProperty("/trafficLightList", aList);
                    self.getLocalDataModel().setProperty("/selectedTrafficLight", sRestoredTrafficLight);

                    // Programmatic selectedKey update does not fire selectionChange,
                    // so explicitly re-apply overlay colors when restoring a saved key.
                    if (sRestoredTrafficLight) {
                        self._trafficLightColorMap = null;
                        self._fetchTrafficLightColors(sRestoredTrafficLight);
                    }
                },
                "error": function () {
                    self.getLocalDataModel().setProperty("/trafficLightList", []);
                }
            });
        },

        onTrafficLightInfoPress: function (oEvent) {
            var oSource = oEvent.getSource();
            var sTrafficLightKey = this.getLocalDataModel().getProperty("/selectedTrafficLight") || "";
            if (!sTrafficLightKey) { return; }

            function unwrap(v) {
                return (v !== null && v !== undefined && typeof v === "object" && "value" in v) ? v.value : v;
            }

            // Reuse responses already fetched by _fetchTrafficLightColors — no new API calls needed.
            // GET rows take priority; fall back to POST rows if GET returned nothing.
            var aGetRows = Array.isArray(this._lastTrafficLightGetRows) ? this._lastTrafficLightGetRows : [];
            var bUseGetRows = aGetRows.length > 0;
            var aDisplayRows = bUseGetRows
                ? aGetRows
                : (Array.isArray(this._lastTrafficLightPostRows) ? this._lastTrafficLightPostRows : []);

            this._openTrafficLightInfoPopover(oSource, aDisplayRows, bUseGetRows, unwrap);
        },

        _openTrafficLightInfoPopover: function (oSource, aDisplayRows, bIsLegendRows, fnUnwrap) {
            var self = this;

            if (this._oTrafficInfoPopover) {
                this._oTrafficInfoPopover.destroy();
                this._oTrafficInfoPopover = null;
            }

            this._oTrafficInfoPopover = new sap.m.Popover({
                title: "Traffic Light Details",
                placement: sap.m.PlacementType.PreferredRightBegin,
                contentWidth: "20rem",
                afterClose: function () {
                    if (self._oTrafficInfoPopover) {
                        self._oTrafficInfoPopover.destroy();
                        self._oTrafficInfoPopover = null;
                    }
                }
            });
            this.getView().addDependent(this._oTrafficInfoPopover);

            var oVBox = new sap.m.VBox();
            oVBox.addStyleClass("sapUiSmallMargin");

            if (!aDisplayRows || !aDisplayRows.length) {
                oVBox.addItem(new sap.m.Text({ text: "No details available" }));
            } else if (bIsLegendRows) {
                // GET response rows: Name + Colour (legend definitions)
                aDisplayRows.forEach(function (oRow) {
                    var sName = String(fnUnwrap(oRow.Name) !== null && fnUnwrap(oRow.Name) !== undefined ? fnUnwrap(oRow.Name) : "");
                    var vColour = fnUnwrap(oRow.Colour);
                    var sHex = "";
                    if (vColour !== null && vColour !== undefined && vColour !== "") {
                        sHex = isNaN(Number(vColour)) ? String(vColour) : self._tcolorToHex(Number(vColour));
                    }
                    oVBox.addItem(
                        new sap.m.HBox({
                            alignItems: "Center",
                            items: sHex
                                ? [
                                    new sap.ui.core.Icon({ src: "sap-icon://circle-task-2", size: "1rem", color: sHex, useIconTooltip: false }),
                                    new sap.m.Text({ text: sName }).addStyleClass("sapUiSmallMarginBegin")
                                ]
                                : [new sap.m.Text({ text: sName })]
                        }).addStyleClass("sapUiTinyMarginTopBottom")
                    );
                });
            } else {
                // POST response rows: component-specific traffic light data
                var bAnyItem = false;
                aDisplayRows.forEach(function (oRow) {
                    var vTrafficLight = fnUnwrap(oRow.TrafficLight);
                    var sLegendName = String(
                        fnUnwrap(oRow.LegendName) !== null && fnUnwrap(oRow.LegendName) !== undefined
                            ? fnUnwrap(oRow.LegendName)
                            : ""
                    );
                    var sHex = "";
                    if (vTrafficLight !== null && vTrafficLight !== undefined && vTrafficLight !== "") {
                        sHex = isNaN(Number(vTrafficLight)) ? String(vTrafficLight) : self._tcolorToHex(Number(vTrafficLight));
                    }
                    if (sHex || sLegendName) {
                        oVBox.addItem(
                            new sap.m.HBox({
                                alignItems: "Center",
                                items: sHex
                                    ? [
                                        new sap.ui.core.Icon({ src: "sap-icon://circle-task-2", size: "1rem", color: sHex, useIconTooltip: false }),
                                        new sap.m.Text({ text: sLegendName || sHex }).addStyleClass("sapUiSmallMarginBegin")
                                    ]
                                    : [new sap.m.Text({ text: sLegendName })]
                            }).addStyleClass("sapUiTinyMarginTopBottom")
                        );
                        bAnyItem = true;
                    }
                });
                if (!bAnyItem) {
                    oVBox.addItem(new sap.m.Text({ text: "No details available" }));
                }
            }

            this._oTrafficInfoPopover.addContent(oVBox);
            this._oTrafficInfoPopover.openBy(oSource);
        },

        onTrafficLightSelect: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sKey = oItem ? oItem.getKey() : "";
            this.getLocalDataModel().setProperty("/selectedTrafficLight", sKey);

            if (!sKey) {
                // Cleared — hide column and reset color map
                this._trafficLightColorMap = null;
                this._lastTrafficLightPostRows = [];
                this._lastTrafficLightGetRows = [];
                this.getLocalDataModel().setProperty("/trafficLightColumnVisible", false);
                this.getLocalDataModel().setProperty("/trafficLightFooterVisible", false);
                this.getLocalDataModel().setProperty("/trafficLightLegendItems", []);
                this._updateLegendFooter();
                // Bump version so formatters re-run and produce hidden placeholders
                var iVer = this.getLocalDataModel().getProperty("/trafficLightVersion") || 0;
                this.getLocalDataModel().setProperty("/trafficLightVersion", iVer + 1);
                this._persistMasterTreeState();
                return;
            }

            // Always reset map so switching traffic light types always produces a fresh result.
            this._trafficLightColorMap = null;
            this._lastTrafficLightPostRows = [];
            this._lastTrafficLightGetRows = [];

            // If the tree has no loaded rows yet, nothing to fetch — the selection is
            // persisted and _loadRootNodes will call _fetchTrafficLightColors once data arrives.
            var aTree = this.getLocalDataModel().getProperty("/treeTable") || [];
            if (aTree.length) {
                this._fetchTrafficLightColors(sKey);
            }
            this._persistMasterTreeState();
        },

        _fetchTrafficLightColors: function (sTrafficLightKey) {
            var self = this;
            var oLocalDataModel = this.getLocalDataModel();
            var aTree = oLocalDataModel.getProperty("/treeTable") || [];

            // Collect all currently loaded component IDs
            var aIds = [];
            self._collectComponentIds(aTree, aIds);

            var fnCall = function (sHash) {
                // Component color POST requires IDs — skip if none are loaded yet.
                if (!aIds.length) {
                    // No component IDs yet — still fetch legend definitions via GET
                    $.ajax({
                        "url": self.isRunninglocally() + "/web/?hash=" + encodeURIComponent(sHash) + "&metaTable=TrafficLightValues&requestType=getTrafficLight&trafficlightKey=" + encodeURIComponent(sTrafficLightKey),
                        "method": "GET",
                        "dataType": "json",
                        "success": function (getLegendResponse) {
                            var aLegendRows = [];
                            if (Array.isArray(getLegendResponse && getLegendResponse.Rows)) {
                                aLegendRows = getLegendResponse.Rows;
                            } else if (Array.isArray(getLegendResponse && getLegendResponse.rows)) {
                                aLegendRows = getLegendResponse.rows;
                            }
                            if (aLegendRows.length > 0) {
                                self._updateLegendFooterFromRows(aLegendRows);
                            } else {
                                self._updateLegendFooter();
                            }
                        },
                        "error": function () {
                            self._updateLegendFooter();
                        }
                    });
                    self.setBusyOff();
                    return;
                }

                self.setBusyOn();
                // Step 1: POST for component-specific traffic light colors
                $.ajax({
                    "url": self.isRunninglocally() + "/web/?hash=" + encodeURIComponent(sHash) + "&metaTable=TrafficLightValues",
                    "method": "POST",
                    "contentType": "application/x-www-form-urlencoded",
                    "data": "requestType=getTrafficLight&trafficlightKey=" + encodeURIComponent(sTrafficLightKey) + "&componentIds=" + encodeURIComponent(JSON.stringify(aIds.map(Number))),
                    "success": function (response) {
                        // Merge into the existing map so any colors accumulated while this
                        // request was in-flight are preserved.
                        var oColorMap = self._trafficLightColorMap || {};
                        var aPostRows = [];
                        if (Array.isArray(response && response.Rows)) {
                            aPostRows = response.Rows;
                        } else if (Array.isArray(response && response.rows)) {
                            aPostRows = response.rows;
                        } else if (Array.isArray(response)) {
                            aPostRows = response;
                        }
                        aPostRows.forEach(function (oRow) {
                            // Unwrap {value: ...} wrapper format if present
                            function unwrap(v) { return (v !== null && v !== undefined && typeof v === "object" && "value" in v) ? v.value : v; }
                            var vRawId = unwrap(oRow.Component_ID) !== null && unwrap(oRow.Component_ID) !== undefined ? unwrap(oRow.Component_ID) : (unwrap(oRow.componentId) !== null && unwrap(oRow.componentId) !== undefined ? unwrap(oRow.componentId) : (unwrap(oRow.id) !== null && unwrap(oRow.id) !== undefined ? unwrap(oRow.id) : ""));
                            var sId = String(vRawId);
                            if (!sId || sId === "null" || sId === "undefined") { return; }
                            // If TrafficLight is null, mark entry so dot is hidden
                            var vTrafficLight = unwrap(oRow.TrafficLight);
                            if (vTrafficLight === null || vTrafficLight === undefined) {
                                oColorMap[sId] = { color: "", legendName: "", showDot: false };
                                return;
                            }
                            // TrafficLight value IS the color integer; fall back to explicit Color fields
                            var vColor = (vTrafficLight !== "") ? vTrafficLight
                                : (unwrap(oRow.Color) || unwrap(oRow.color) || unwrap(oRow.TLV_Color) || unwrap(oRow.tlvColor) || "");
                            var sLegendName = String(unwrap(oRow.LegendName) !== null && unwrap(oRow.LegendName) !== undefined ? unwrap(oRow.LegendName) : (unwrap(oRow.legendName) || ""));
                            if (vColor !== "" && vColor !== null && vColor !== undefined) {
                                var sHex = isNaN(Number(vColor)) ? String(vColor) : self._tcolorToHex(Number(vColor));
                                if (sHex) { oColorMap[sId] = { color: sHex, legendName: sLegendName, showDot: true }; }
                            }
                        });
                        self._trafficLightColorMap = oColorMap;
                        self._lastTrafficLightPostRows = aPostRows;
                        oLocalDataModel.setProperty("/trafficLightColumnVisible", true);
                        // Bump version so ALL formatTrafficDot formatters re-run
                        // and read the freshly updated _trafficLightColorMap.
                        var iVer = oLocalDataModel.getProperty("/trafficLightVersion") || 0;
                        oLocalDataModel.setProperty("/trafficLightVersion", iVer + 1);

                        // Step 2: GET legend definitions — rows take priority over POST for legend display
                        $.ajax({
                            "url": self.isRunninglocally() + "/web/?hash=" + encodeURIComponent(sHash) + "&metaTable=TrafficLightValues&requestType=getTrafficLight&trafficlightKey=" + encodeURIComponent(sTrafficLightKey),
                            "method": "GET",
                            "dataType": "json",
                            "success": function (getLegendResponse) {
                                var aLegendRows = [];
                                if (Array.isArray(getLegendResponse && getLegendResponse.Rows)) {
                                    aLegendRows = getLegendResponse.Rows;
                                } else if (Array.isArray(getLegendResponse && getLegendResponse.rows)) {
                                    aLegendRows = getLegendResponse.rows;
                                }
                                self._lastTrafficLightGetRows = aLegendRows;
                                if (aLegendRows.length > 0) {
                                    self._updateLegendFooterFromRows(aLegendRows);
                                } else {
                                    self._updateLegendFooter();
                                }
                                self.setBusyOff();
                            },
                            "error": function () {
                                self._lastTrafficLightGetRows = [];
                                self._updateLegendFooter();
                                self.setBusyOff();
                            }
                        });
                    },
                    "error": function () {
                        self.setBusyOff();
                        sap.m.MessageToast.show("Failed to load traffic light data");
                    }
                });
            };

            if (this.hash) {
                fnCall(this.hash);
            } else {
                this.getoHashToken().done(function (result) {
                    if (result && result.hash) { fnCall(result.hash); }
                });
            }
        },

        _collectComponentIds: function (aNodes, aIds) {
            var self = this;
            aNodes.forEach(function (oNode) {
                // Skip placeholder rows (no Component_ID)
                if (!oNode.Component_ID && oNode.Component_ID !== 0) { return; }
                // Unwrap {value: ...} wrapper that some API responses produce
                var vId = (oNode.Component_ID !== null && oNode.Component_ID !== undefined && typeof oNode.Component_ID === "object" && "value" in oNode.Component_ID) ? oNode.Component_ID.value : oNode.Component_ID;
                var sId = String(vId);
                if (!sId || sId === "null" || sId === "undefined") { return; }
                if (aIds.indexOf(sId) === -1) { aIds.push(sId); }
                if (Array.isArray(oNode.rows) && oNode.rows.length > 0) {
                    self._collectComponentIds(oNode.rows, aIds);
                }
            });
        },

        _clearTrafficLightColors: function (aNodes) {
            var self = this;
            aNodes.forEach(function (oNode) {
                oNode.trafficLightDot = "";
                if (Array.isArray(oNode.rows) && oNode.rows.length > 0) {
                    self._clearTrafficLightColors(oNode.rows);
                }
            });
        },

        /**
         * Resolves the Component_ID to an entry in _trafficLightColorMap.
         * @private
         */
        _resolveTrafficEntry: function (vComponentId) {
            if (vComponentId === null || vComponentId === undefined) { return null; }
            var sId = String(typeof vComponentId === "object" && "value" in vComponentId ? vComponentId.value : vComponentId);
            if (!sId || sId === "null" || sId === "undefined") { return null; }
            var oMap = this._trafficLightColorMap || {};
            return oMap[sId] || null;
        },

        /**
         * Formatter: returns the hex color for the traffic-light Icon.
         */
        formatTrafficDotColor: function (vComponentId, iVersion) {
            var oEntry = this._resolveTrafficEntry(vComponentId);
            if (oEntry && oEntry.showDot && oEntry.color) {
                return oEntry.color;
            }
            return "transparent";
        },

        /**
         * Formatter: returns whether the traffic-light Icon should be visible.
         */
        formatTrafficDotVisible: function (vComponentId, iVersion) {
            var oEntry = this._resolveTrafficEntry(vComponentId);
            return !!(oEntry && oEntry.showDot && oEntry.color);
        },

        /**
         * Formatter: returns a tooltip string for the traffic-light Icon.
         */
        formatTrafficDotTooltip: function (vComponentId, iVersion) {
            var oEntry = this._resolveTrafficEntry(vComponentId);
            if (oEntry && oEntry.showDot) {
                var sLegend = oEntry.legendName ? oEntry.legendName : "";
                var sSelectedKey = this.getLocalDataModel().getProperty("/selectedTrafficLight") || "";
                var aList = this.getLocalDataModel().getProperty("/trafficLightList") || [];
                var oMatch = aList.find(function (oItem) { return String(oItem.CO_ID) === String(sSelectedKey); });
                var sTrafficLightName = oMatch ? (oMatch.Name || "") : "";
                return (sTrafficLightName ? sTrafficLightName + ": " : "") + sLegend;
            }
            return "";
        },

        /**
         * Rebuilds the floating footer legend bar from the current _trafficLightColorMap.
         * Shows one colored dot + label per unique (color, legendName) pair found in the map.
         */
        _updateLegendFooter: function () {
            var oFlex = this.byId("trafficLightLegendFlex");
            if (!oFlex) { return; }

            // Remove all items except the static "Legend:" Text (first item)
            var aItems = oFlex.getItems();
            for (var i = aItems.length - 1; i >= 1; i--) {
                oFlex.removeItem(aItems[i]);
            }

            var oMap = this._trafficLightColorMap || {};
            var aUnique = [];
            var oSeen = {};

            Object.keys(oMap).forEach(function (sId) {
                var oEntry = oMap[sId];
                if (!oEntry || !oEntry.showDot || !oEntry.color) { return; }
                var sKey = oEntry.color + "|" + (oEntry.legendName || "");
                if (!oSeen[sKey]) {
                    oSeen[sKey] = true;
                    aUnique.push(oEntry);
                }
            });

            // Sort by legendName for a consistent order
            aUnique.sort(function (a, b) {
                return (a.legendName || "").localeCompare(b.legendName || "");
            });

            if (!aUnique.length) {
                this.getLocalDataModel().setProperty("/trafficLightFooterVisible", false);
                this.getLocalDataModel().setProperty("/trafficLightLegendItems", []);
                return;
            }

            this.getLocalDataModel().setProperty("/trafficLightLegendItems", aUnique);

            aUnique.forEach(function (oEntry) {
                oFlex.addItem(
                    new sap.m.HBox({
                        alignItems: "Center",
                        items: [
                            new sap.ui.core.Icon({
                                src: "sap-icon://circle-task-2",
                                size: "1rem",
                                color: oEntry.color,
                                useIconTooltip: false
                            }),
                            new sap.m.Text({
                                text: oEntry.legendName || ""
                            }).addStyleClass("sapUiSmallMarginBegin")
                        ]
                    }).addStyleClass("sapUiSmallMarginBegin sapUiTinyMarginTopBottom")
                );
            });

            this.getLocalDataModel().setProperty("/trafficLightFooterVisible", true);
        },

        _updateLegendFooterFromRows: function (aRows) {
            var self = this;
            var oFlex = this.byId("trafficLightLegendFlex");
            if (!oFlex) { return; }

            // Remove all items except the static "Legend:" Text (first item)
            var aItems = oFlex.getItems();
            for (var i = aItems.length - 1; i >= 1; i--) {
                oFlex.removeItem(aItems[i]);
            }

            function unwrap(v) { return (v !== null && v !== undefined && typeof v === "object" && "value" in v) ? v.value : v; }

            var aUnique = [];
            aRows.forEach(function (oRow) {
                var sName = String(unwrap(oRow.Name) !== null && unwrap(oRow.Name) !== undefined ? unwrap(oRow.Name) : "");
                var vColour = unwrap(oRow.Colour);
                if (vColour !== null && vColour !== undefined && vColour !== "") {
                    var sHex = isNaN(Number(vColour)) ? String(vColour) : self._tcolorToHex(Number(vColour));
                    if (sHex) {
                        aUnique.push({ color: sHex, legendName: sName });
                    }
                }
            });

            if (!aUnique.length) {
                this.getLocalDataModel().setProperty("/trafficLightFooterVisible", false);
                this.getLocalDataModel().setProperty("/trafficLightLegendItems", []);
                return;
            }

            // Sort legend entries alphabetically by legendName for consistent display
            aUnique.sort(function (a, b) {
                return (a.legendName || "").localeCompare(b.legendName || "");
            });

            this.getLocalDataModel().setProperty("/trafficLightLegendItems", aUnique);

            aUnique.forEach(function (oEntry) {
                oFlex.addItem(
                    new sap.m.HBox({
                        alignItems: "Center",
                        items: [
                            new sap.ui.core.Icon({
                                src: "sap-icon://circle-task-2",
                                size: "1rem",
                                color: oEntry.color,
                                useIconTooltip: false
                            }),
                            new sap.m.Text({
                                text: oEntry.legendName || ""
                            }).addStyleClass("sapUiSmallMarginBegin")
                        ]
                    }).addStyleClass("sapUiSmallMarginBegin sapUiTinyMarginTopBottom")
                );
            });

            this.getLocalDataModel().setProperty("/trafficLightFooterVisible", true);
        },

        _tcolorToHex: function (tcolor) {
            if (isNaN(tcolor) || tcolor < 0) { return null; }
            var v = tcolor >>> 0;
            var r = v & 0xFF;
            var g = (v >>> 8) & 0xFF;
            var b = (v >>> 16) & 0xFF;
            return "#" + [r, g, b].map(function (n) { return n.toString(16).padStart(2, "0"); }).join("").toUpperCase();
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
                    // Sort asset list alphabetically by Name (case-insensitive)
                    aTreeList.sort(function (a, b) {
                        var sA = String(a.Name || "").toLowerCase();
                        var sB = String(b.Name || "").toLowerCase();
                        return sA < sB ? -1 : sA > sB ? 1 : 0;
                    });
                    this.getLocalDataModel().setProperty("/treeList", aTreeList);
                    if (aTreeList.length > 0) {
                        this.getLocalDataModel().setProperty("/treeTableNoDataText", this.getResourceBundle().getText("msgSelectAssetToView"));
                        // Preserve previously selected asset if it still exists in the list
                        var sPreviousKey = this.getLocalDataModel().getProperty("/selectedNode");
                        var sSessionKey = this._masterSessionState && this._masterSessionState.activeView;
                        var oSelectedNode = null;
                        if (sSessionKey) {
                            oSelectedNode = aTreeList.find(function (oItem) {
                                return String(oItem.CV_ID) === String(sSessionKey);
                            });
                        }
                        if (!oSelectedNode && sPreviousKey) {
                            oSelectedNode = aTreeList.find(function (oItem) {
                                return String(oItem.CV_ID) === String(sPreviousKey);
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
            this._persistMasterTreeState(null, oSelectedNode && oSelectedNode.CV_ID);
        },

        focusNodeInTree: function (sChannel, sEvent, oData) {
            var oNode = oData && oData.nodeData;
            var sTargetFullLocation = (oData && oData.fullLocation) || (oNode && this._getFullLocation(oNode));
            var sTargetAsset = (oData && oData.CV_ID) || (oNode && oNode.CV_ID);
            var bIsBreadcrumbClick = sChannel === "Master" && sEvent === "FocusNodeFromBreadcrumb";
            if (!sTargetFullLocation) {
                return;
            }

            var oLocalDataModel = this.getLocalDataModel();
            var sCurrentAsset = oLocalDataModel.getProperty("/selectedNode");
            if (sTargetAsset && String(sTargetAsset) !== String(sCurrentAsset)) {
                var self = this;
                var aTreeList = oLocalDataModel.getProperty("/treeList") || [];
                var oAssetItem = null;
                for (var i = 0; i < aTreeList.length; i++) {
                    if (String(aTreeList[i].CV_ID) === String(sTargetAsset)) {
                        oAssetItem = aTreeList[i];
                        break;
                    }
                }
                if (oAssetItem) {
                    oLocalDataModel.setProperty("/selectedNode", sTargetAsset);
                    this._loadRootNodes(oAssetItem, function () {
                        self.focusNodeInTree(sChannel, sEvent, oData);
                    });
                    return;
                }
            }

            var oTreeTable = this.byId("TreeTableBasic");
            if (!oTreeTable) {
                return;
            }

            var oRowIndexMap = this._buildRowIndexMap(oTreeTable);
            if (oRowIndexMap.hasOwnProperty(sTargetFullLocation)) {
                var iRowIndex = oRowIndexMap[sTargetFullLocation];
                this._collapseNonAncestors(sTargetFullLocation, oTreeTable);
                this._selectRowByIndex(oTreeTable, iRowIndex);
                // For breadcrumb clicks, collapse the target node's children to show the target only
                if (bIsBreadcrumbClick && oTreeTable.isExpanded(iRowIndex)) {
                    oTreeTable.collapse(iRowIndex);
                }
                return;
            }

            // Collapse all non-ancestor branches before expanding the path to the breadcrumb node
            this._collapseNonAncestors(sTargetFullLocation, oTreeTable);
            var self = this;
            this._expandPathToNode(sTargetFullLocation, oTreeTable, function (oTargetRow, iTargetIndex) {
                self._selectRowByIndex(oTreeTable, iTargetIndex);
                // For breadcrumb clicks, collapse the target node's children after selection
                if (bIsBreadcrumbClick && oTreeTable.isExpanded(iTargetIndex)) {
                    oTreeTable.collapse(iTargetIndex);
                }
            });
        },
        
        /**
         * Collapse all rows that are not ancestors of the target location.
         * This ensures only the path to the target node is expanded, preventing orphaned expanded branches.
         * @param {string} sTargetFullLocation - Full location path of the target node
         * @param {Object} oTreeTable - TreeTable control
         */
        _collapseNonAncestors: function (sTargetFullLocation, oTreeTable) {
            if (!oTreeTable || !sTargetFullLocation) return;
            var aSegments = this._getPathSegments(sTargetFullLocation);
            if (!aSegments || aSegments.length === 0) return;
            var oAncestors = {};
            for (var i = 0; i < aSegments.length; i++) { // Preserve the target node as well as its ancestors
                oAncestors[aSegments.slice(0, i + 1).join(" / ")] = true;
            }
            var oMap = this._buildRowIndexMap(oTreeTable);
            Object.keys(oMap).forEach(function (sPath) {
                if (!oAncestors[sPath] && oTreeTable.isExpanded(oMap[sPath])) {
                    oTreeTable.collapse(oMap[sPath]);
                }
            });
        },
        
        /**
         * Build index map of Full_Location -> row index for O(1) lookups
         * @param {Object} oTreeTable - TreeTable control
         * @returns {Object} Object with Full_Location as key, row index as value
         */
        _buildRowIndexMap: function(oTreeTable) {
            var oMap = {};
            var oBinding = oTreeTable.getBinding("rows");

            // Use binding contexts instead of rendered rows so off-screen rows are also addressable.
            if (oBinding && typeof oBinding.getLength === "function") {
                var iLength = oBinding.getLength();
                if (typeof oBinding.getContexts === "function") {
                    var aContexts = oBinding.getContexts(0, iLength) || [];
                    for (var i = 0; i < aContexts.length; i++) {
                        var oRowContext = aContexts[i];
                        if (!oRowContext) {
                            continue;
                        }
                        var oRowData = oRowContext.getObject();
                        var sFullLocation = this._getFullLocation(oRowData);
                        if (sFullLocation) {
                            oMap[sFullLocation] = i;
                        }
                    }
                    return oMap;
                }

                for (var j = 0; j < iLength; j++) {
                    var oIndexedContext = oTreeTable.getContextByIndex(j);
                    if (!oIndexedContext) {
                        continue;
                    }
                    var oIndexedData = oIndexedContext.getObject();
                    var sIndexedFullLocation = this._getFullLocation(oIndexedData);
                    if (sIndexedFullLocation) {
                        oMap[sIndexedFullLocation] = j;
                    }
                }
                return oMap;
            }

            var aRows = oTreeTable.getRows();
            for (var k = 0; k < aRows.length; k++) {
                var oFallbackContext = aRows[k].getBindingContext("LocalDataModel");
                if (oFallbackContext) {
                    var oFallbackData = oFallbackContext.getObject();
                    var sFallbackFullLocation = this._getFullLocation(oFallbackData);
                    if (sFallbackFullLocation) {
                        oMap[sFallbackFullLocation] = k;
                    }
                }
            }
            return oMap;
        },

        _areChildRowsLoaded: function (oNode) {
            return !!(oNode && oNode.rows && oNode.rows.length > 0 && oNode.rows[0] && oNode.rows[0].VN_ID);
        },

        _mapTreeRows: function (aRows) {
            var aMissingAssetTypes = [];
            var aMappedRows = (aRows || []).map(function (oRow) {
                var sAssetName = oRow.Name || oRow.Full_location || oRow.Full_Location || oRow.full_location || oRow.FullLocation || "";
                var bHasChild = oRow.Has_Children === true;
                var aChildRows = bHasChild ? [{ rows: [] }] : [];
                var sCtId = String(oRow.CT_ID || "");
                var sAssetType = this._compTypeMap[sCtId] || sCtId;
                if (sCtId && !this._compTypeMap[sCtId] && aMissingAssetTypes.indexOf(sCtId) === -1) {
                    aMissingAssetTypes.push(sCtId);
                }
                var vCompId = oRow.Component_ID;
                if (vCompId !== null && vCompId !== undefined && typeof vCompId === "object" && "value" in vCompId) { vCompId = vCompId.value; }
                var oMappedRow = Object.assign({}, oRow, {
                    Name: sAssetName,
                    AssetType: sAssetType,
                    Has_Children: bHasChild,
                    rows: aChildRows,
                    trafficLightDot: "",
                    Component_ID: vCompId
                });
                this._normalizeFullLocation(oMappedRow);
                return oMappedRow;
            }.bind(this));

            aMappedRows.sort(function(a, b) {
                var nameA = (a.Name || "").toLowerCase();
                var nameB = (b.Name || "").toLowerCase();
                if (nameA < nameB) return -1;
                if (nameA > nameB) return 1;
                return 0;
            });

            if (aMissingAssetTypes.length > 0) {
                console.warn("Asset types missing names: ", aMissingAssetTypes);
            }

            return aMappedRows;
        },

        _loadChildNodes: function (oSelectedRow, sPath, fnAfterLoad) {
            var self = this;
            if (!oSelectedRow || !oSelectedRow.Has_Children || !sPath) {
                if (typeof fnAfterLoad === "function") {
                    fnAfterLoad([]);
                }
                return;
            }

            var sCvId = oSelectedRow.CV_ID;
            var sRootVnId = oSelectedRow.VN_ID;

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
                    var aRows = this._mapTreeRows(Array.isArray(response && response.rows) ? response.rows : []);
                    aRows.forEach(function(oRow) {
                        this.addNodeToInfoArr(oRow);
                    }.bind(this));

                    var oLocalDataModel = self.getLocalDataModel();
                    var sSelectedKey = oLocalDataModel.getProperty("/selectedTrafficLight");
                    oLocalDataModel.setProperty(sPath, aRows);
                    self.setBusyOff();

                    if (sSelectedKey) {
                        self._fetchAndMergeChildColors(sSelectedKey, aRows);
                    } else {
                        oLocalDataModel.refresh(true);
                    }

                    if (typeof fnAfterLoad === "function") {
                        fnAfterLoad(aRows);
                    }
                }.bind(this),
                "error": function () {
                    MessageBox.error(this.getResourceBundle().getText("msgErrorFetchingChildNodes"));
                    this.setBusyOff();
                }.bind(this)
            });
        },

        _expandPathToNode: function(sTargetFullLocation, oTreeTable, fnAfterSelect) {
            if (!oTreeTable) {
                oTreeTable = this.byId("TreeTableBasic");
                if (!oTreeTable) return;
            }
            if (!sTargetFullLocation) {
                return;
            }

            var self = this;
            var aPathSegments = this._getPathSegments(sTargetFullLocation);
            if (!aPathSegments || aPathSegments.length === 0) {
                return;
            }

            var aAncestorPaths = [];
            for (var j = 0; j < aPathSegments.length - 1; j++) {
                aAncestorPaths.push(aPathSegments.slice(0, j + 1).join(" / "));
            }

            var iMaxRetries = 80;

            var fnSelectIfVisible = function () {
                var oMap = self._buildRowIndexMap(oTreeTable);
                if (oMap.hasOwnProperty(sTargetFullLocation)) {
                    var iTargetIndex = oMap[sTargetFullLocation];
                    self._selectRowByIndex(oTreeTable, iTargetIndex);
                    if (typeof fnAfterSelect === "function") {
                        var oTargetContext = oTreeTable.getContextByIndex(iTargetIndex);
                        var oTargetRow = oTargetContext ? oTargetContext.getProperty(oTargetContext.getPath()) : null;
                        fnAfterSelect(oTargetRow, iTargetIndex);
                    }
                    return true;
                }
                return false;
            };

            var fnExpandAncestorAt = function (iAncestorPos, iRetry) {
                if (fnSelectIfVisible()) {
                    return;
                }

                if (iAncestorPos >= aAncestorPaths.length) {
                    return;
                }

                var sAncestorPath = aAncestorPaths[iAncestorPos];
                var oRowIndexMap = self._buildRowIndexMap(oTreeTable);
                if (!oRowIndexMap.hasOwnProperty(sAncestorPath)) {
                    if (iRetry < iMaxRetries) {
                        setTimeout(function () {
                            fnExpandAncestorAt(iAncestorPos, iRetry + 1);
                        }, 120);
                    }
                    return;
                }

                var iAncestorIndex = oRowIndexMap[sAncestorPath];
                var oAncestorContext = oTreeTable.getContextByIndex(iAncestorIndex);
                var oAncestorData = oAncestorContext ? oAncestorContext.getProperty(oAncestorContext.getPath()) : null;
                var fnExpandAncestor = function () {
                    var oUpdatedMap = self._buildRowIndexMap(oTreeTable);
                    if (!oUpdatedMap.hasOwnProperty(sAncestorPath)) {
                        fnExpandAncestorAt(iAncestorPos, iRetry + 1);
                        return;
                    }
                    var iUpdatedIndex = oUpdatedMap[sAncestorPath];
                    if (!oTreeTable.isExpanded(iUpdatedIndex)) {
                        var fnAfterRowsUpdated = function () {
                            oTreeTable.detachEvent("rowsUpdated", fnAfterRowsUpdated);
                            fnExpandAncestorAt(iAncestorPos + 1, 0);
                        };
                        oTreeTable.attachEvent("rowsUpdated", fnAfterRowsUpdated);
                        oTreeTable.expand(iUpdatedIndex);
                        return;
                    }
                    fnExpandAncestorAt(iAncestorPos + 1, 0);
                };

                if (oAncestorData && oAncestorData.Has_Children && !self._areChildRowsLoaded(oAncestorData)) {
                    self._loadChildNodes(oAncestorData, oAncestorContext.getPath() + "/rows", function () {
                        oTreeTable.attachEventOnce("rowsUpdated", function () {
                            fnExpandAncestor();
                        });
                    });
                    return;
                }

                fnExpandAncestor();
            };

            fnExpandAncestorAt(0, 0);
        },

        _selectAndRevealRow: function (oTreeTable, iIndex) {
            if (!oTreeTable || iIndex < 0) {
                return;
            }
            oTreeTable.setSelectedIndex(iIndex);
            if (typeof oTreeTable.setFirstVisibleRow === "function") {
                oTreeTable.setFirstVisibleRow(Math.max(0, iIndex - 3));
            }
        },

        _selectRowByIndex: function (oTreeTable, iIndex) {
            this._selectAndRevealRow(oTreeTable, iIndex);
            var oContext = oTreeTable.getContextByIndex(iIndex);
            if (oContext) {
                var oRow = oContext.getProperty(oContext.getPath());
                if (oRow) {
                    this._applySelectedRowState(oRow, false);
                }
            }
        },

        _resolveFocusedPathByVnId: function (sFocusedId, fnDone) {
            if (!sFocusedId || sFocusedId === "-1") {
                if (typeof fnDone === "function") {
                    fnDone("");
                }
                return;
            }

            var self = this;
            var fnCall = function (sHash) {
                $.ajax({
                    "url": self.isRunninglocally() + "/bo/View_Node/",
                    "method": "GET",
                    "dataType": "json",
                    "headers": {
                        "X-NEXUS-Filter": '{"where":[{"field":"VN_ID","method":"eq","value":"' + String(sFocusedId) + '"}]}'
                    },
                    "data": {
                        "hash": sHash
                    },
                    "success": function (response) {
                        var aRows = Array.isArray(response && response.rows) ? response.rows : [];
                        var oRow = aRows.length > 0 ? aRows[0] : null;
                        var sFullLocation = self._getFullLocation(oRow) || "";
                        if (typeof fnDone === "function") {
                            fnDone(sFullLocation);
                        }
                    },
                    "error": function () {
                        if (typeof fnDone === "function") {
                            fnDone("");
                        }
                    }
                });
            };

            if (this.hash) {
                fnCall(this.hash);
                return;
            }

            this.getoHashToken().done(function (result) {
                if (result && result.hash) {
                    self.hash = result.hash;
                    fnCall(self.hash);
                    return;
                }
                if (typeof fnDone === "function") {
                    fnDone("");
                }
            });
        },

        _restoreInitialTreeSelection: function (oTreeTable, aRows) {
            // No auto-selection on load — user must explicitly click a node.
        },

        _loadRootNodes: function (oSelectedNode, fnAfterLoad) {
            if (!oSelectedNode || !oSelectedNode.CV_ID) {
                if (typeof fnAfterLoad === "function") {
                    fnAfterLoad([]);
                }
                return;
            }
            var self = this;
            var oLocalDataModel = this.getLocalDataModel();

            // Switching asset view must clear stale detail content and cached node selections
            // before the new hierarchy is loaded.
            oLocalDataModel.setProperty("/selectedNodeData", null);
            oLocalDataModel.setProperty("/detailTiles", []);
            oLocalDataModel.setProperty("/detailTileGroups", []);
            oLocalDataModel.setProperty("/breadcrumb", []);
            oLocalDataModel.setProperty("/nodeInfoArray", []);

            // Keep duplicate tracking map in sync with nodeInfoArray reset.
            this._nodeInfoMap = {};
            this._bNodeInfoMapValid = false;

            var oTreeTable = this.byId("TreeTableBasic");
            if (oTreeTable) {
                oTreeTable.clearSelection();
            }

            this.setBusyOn();
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
                    aRows = this._mapTreeRows(aRows);
                    this.getLocalDataModel().setProperty("/treeTable", aRows);
                    this.getLocalDataModel().setProperty("/treeTableNoDataText", aRows.length ? "" : this.getResourceBundle().getText("msgNoAssetsAvailable"));

                    // If a traffic light overlay is selected, check the web API response for TrafficLight
                    // values, compare Component_ID from it with View_Node Component_IDs, and display
                    // the color in column 3 for matching nodes.
                    var sSelectedTrafficLight = this.getLocalDataModel().getProperty("/selectedTrafficLight");
                    if (sSelectedTrafficLight) {
                        // Reset map so old-asset colors (from a previous _loadRootNodes call) are
                        // not preserved when a completely new asset hierarchy is loaded.
                        this._trafficLightColorMap = null;
                        this._fetchTrafficLightColors(sSelectedTrafficLight);
                    }

                    // Populate nodeInfoArray with root nodes so they're available for auto-selection
                    aRows.forEach(function(oRow) {
                        this.addNodeToInfoArr(oRow);
                    }.bind(this));
                    
                    // Collapse all root nodes after the TreeTable has processed the new data
                    oTreeTable = this.byId("TreeTableBasic");
                    if (oTreeTable) {
                        oTreeTable.attachEventOnce("rowsUpdated", function () {
                            oTreeTable.collapseAll();
                            this._restoreInitialTreeSelection(oTreeTable, aRows);
                            if (typeof fnAfterLoad === "function") {
                                fnAfterLoad(aRows);
                            }
                        }.bind(this));
                    } else if (typeof fnAfterLoad === "function") {
                        fnAfterLoad(aRows);
                    }
                    // When a traffic light fetch is triggered it calls setBusyOn synchronously;
                    // calling setBusyOff here would turn the indicator off before that fetch
                    // completes (visible flicker). Let _fetchTrafficLightColors own the final off.
                    if (!sSelectedTrafficLight) {
                        this.setBusyOff();
                    }
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
            if (!oSelectedRow) {
                return;
            }

            this._applySelectedRowState(oSelectedRow, true);
        },

        _applySelectedRowState: function (oSelectedRow, bPersistSelection) {
            if (!oSelectedRow) {
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

            if (sCtId) {
                this.fetchDetailTiles(sCtId, sCompoonentID, this.hash);
            } else {
                // Nodes without asset type: clear dynamic tiles but still activate the Detail panel.
                oLocalDataModel.setProperty("/detailTiles", []);
                oLocalDataModel.setProperty("/detailTileGroups", []);
                var oNextUIState = this.getOwnerComponent().getHelper().getNextUIState(1);
                this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
                this.getRouter().navTo("Detail", { layout: oNextUIState.layout });
                this.setBusyOff();
            }
            // Publish event to update breadcrumbs in Detail controller only after row selection
            sap.ui.getCore().getEventBus().publish("Detail", "UpdateBreadcrumb");

            if (bPersistSelection) {
                this._persistMasterTreeState(oSelectedRow);
            }
        },

        _parseMasterSessionState: function (aSettings) {
            var oState = {};
            (aSettings || []).forEach(function (oRow) {
                if (oRow && oRow.identifier) {
                    oState[oRow.identifier] = oRow.value !== undefined && oRow.value !== null ? String(oRow.value) : "";
                }
            });
            return oState;
        },

        _getMasterRowPersistId: function (oRow) {
            if (!oRow) {
                return "";
            }
            var vId = oRow.VN_ID;
            if (vId === undefined || vId === null || vId === "") {
                vId = oRow.Component_ID;
            }
            if (vId === undefined || vId === null || vId === "") {
                vId = oRow.ID;
            }
            return vId !== undefined && vId !== null ? String(vId) : "";
        },

        _getInitialSelectedRowIndex: function (aRows) {
            var sFocusedId = this._masterSessionState && (this._masterSessionState.focusedRow || this._masterSessionState.selectedItems);
            if (!sFocusedId || !Array.isArray(aRows) || aRows.length === 0) {
                return -1;
            }

            var sTargetId = String(sFocusedId);
            for (var i = 0; i < aRows.length; i++) {
                if (this._getMasterRowPersistId(aRows[i]) === sTargetId) {
                    return i;
                }
            }
            return -1;
        },

        _persistMasterTreeState: function (oSelectedRow, sActiveViewOverride) {
            var oLocalDataModel = this.getLocalDataModel();
            var sActiveView = sActiveViewOverride || oLocalDataModel.getProperty("/selectedNode") || "";
            var bAssetViewChangeOnly = !!sActiveViewOverride && !oSelectedRow;
            var oRow = bAssetViewChangeOnly ? null : (oSelectedRow || oLocalDataModel.getProperty("/selectedNodeData"));
            var sRowId = this._getMasterRowPersistId(oRow) || "-1";
            var sTrafficLight = oLocalDataModel.getProperty("/selectedTrafficLight") || "-1";

            var aPayload = [
                {
                    category: "Tree",
                    subCategory: "Asset Location",
                    identifier: "activeView",
                    value: String(sActiveView)
                },
                {
                    category: "Tree",
                    subCategory: "Asset Location",
                    identifier: "focusedRow",
                    value: sRowId
                },
                {
                    category: "Tree",
                    subCategory: "Asset Location",
                    identifier: "selectedItems",
                    value: sRowId
                },
                {
                    category: "Tree",
                    subCategory: "Asset Location",
                    identifier: "trafficLight",
                    value: String(sTrafficLight)
                }
            ];

            if (this.hash) {
                this.saveSessionState(this.hash, aPayload);
                return;
            }

            this.getoHashToken().done(function (result) {
                if (result && result.hash) {
                    this.hash = result.hash;
                    this.saveSessionState(this.hash, aPayload);
                }
            }.bind(this));
        },
        onToggleOpenState: function (oEvent) {
            var oContext = oEvent.getParameter("rowContext");
            var bExpanded = oEvent.getParameter("expanded");
            if (!bExpanded || !oContext) {
                return;
            }
            var oSelectedRow = oContext.getProperty(oContext.getPath());
            if (!oSelectedRow || !oSelectedRow.Has_Children) {
                return;
            }
            var sPath = oContext.getPath() + "/rows";

            // If children are already loaded, re-fetch their traffic light colors
            // (covers the case where traffic light was selected after the first expand)
            if (this._areChildRowsLoaded(oSelectedRow)) {
                var sSelectedKeyExpand = this.getLocalDataModel().getProperty("/selectedTrafficLight");
                if (sSelectedKeyExpand) {
                    var aExistingChildren = oSelectedRow.rows || [];
                    if (aExistingChildren.length) {
                        this._fetchAndMergeChildColors(sSelectedKeyExpand, aExistingChildren);
                    } else {
                        // Bump version so formatters re-run on the re-revealed rows
                        var iV = this.getLocalDataModel().getProperty("/trafficLightVersion") || 0;
                        this.getLocalDataModel().setProperty("/trafficLightVersion", iV + 1);
                    }
                }
                return;
            }

            this._loadChildNodes(oSelectedRow, sPath);
        },

        /**
         * Called after a tree node expands and its children are written to the model.
         * 1. Re-applies the existing color map immediately so parent nodes keep their dots.
         * 2. Fetches traffic light colors for the new child IDs from the API.
         * 3. Merges ONLY the entries whose Component_ID was explicitly requested into the
         *    map — server-recalculated ancestor entries in the response are ignored to
         *    prevent them from overwriting already-correct parent colors.
         *
         * @param {string} sKey         - Selected traffic light overlay key
         * @param {Array}  aNewChildRows - Newly loaded child rows from the expand response
         */
        _fetchAndMergeChildColors: function (sKey, aNewChildRows) {
            var self = this;
            var oLocalDataModel = this.getLocalDataModel();

            // Collect Component_IDs for the new children only
            var aNewIds = [];
            this._collectComponentIds(aNewChildRows, aNewIds);
            if (!aNewIds.length) { return; }

            // Build a Set-like lookup so we can filter the response to requested IDs only
            var oRequestedIds = {};
            aNewIds.forEach(function (sId) { oRequestedIds[sId] = true; });

            var fnCall = function (sHash) {
                self.setBusyOn();
                $.ajax({
                    "url": self.isRunninglocally() + "/web/?hash=" + encodeURIComponent(sHash) + "&metaTable=TrafficLightValues",
                    "method": "POST",
                    "contentType": "application/x-www-form-urlencoded",
                    "data": "requestType=getTrafficLight&trafficlightKey=" + encodeURIComponent(sKey) + "&componentIds=" + encodeURIComponent(JSON.stringify(aNewIds.map(Number))),
                    "success": function (response) {
                        var aRows = [];
                        if (Array.isArray(response && response.Rows)) { aRows = response.Rows; }
                        else if (Array.isArray(response && response.rows)) { aRows = response.rows; }
                        else if (Array.isArray(response)) { aRows = response; }

                        function unwrap(v) { return (v !== null && v !== undefined && typeof v === "object" && "value" in v) ? v.value : v; }

                        var oColorMap = self._trafficLightColorMap || {};
                        aRows.forEach(function (oRow) {
                            var vRawId = unwrap(oRow.Component_ID) !== null && unwrap(oRow.Component_ID) !== undefined ? unwrap(oRow.Component_ID)
                                : (unwrap(oRow.componentId) !== null && unwrap(oRow.componentId) !== undefined ? unwrap(oRow.componentId)
                                : (unwrap(oRow.id) !== null && unwrap(oRow.id) !== undefined ? unwrap(oRow.id) : ""));
                            var sId = String(vRawId);
                            if (!sId || sId === "null" || sId === "undefined") { return; }

                            // Only accept entries we explicitly requested — ignore server-recalculated
                            // ancestor values that would overwrite already-correct parent colors.
                            if (!oRequestedIds[sId]) { return; }

                            var vTrafficLight = unwrap(oRow.TrafficLight);
                            if (vTrafficLight === null || vTrafficLight === undefined) {
                                // Never overwrite an existing showDot:true entry with showDot:false
                                if (!oColorMap[sId] || !oColorMap[sId].showDot) {
                                    oColorMap[sId] = { color: "", legendName: "", showDot: false };
                                }
                                return;
                            }
                            var vColor = (vTrafficLight !== "") ? vTrafficLight
                                : (unwrap(oRow.Color) || unwrap(oRow.color) || unwrap(oRow.TLV_Color) || unwrap(oRow.tlvColor) || "");
                            var sLegendName = String(unwrap(oRow.LegendName) !== null && unwrap(oRow.LegendName) !== undefined ? unwrap(oRow.LegendName) : (unwrap(oRow.legendName) || ""));
                            if (vColor !== "" && vColor !== null && vColor !== undefined) {
                                var sHex = isNaN(Number(vColor)) ? String(vColor) : self._tcolorToHex(Number(vColor));
                                if (sHex) { oColorMap[sId] = { color: sHex, legendName: sLegendName, showDot: true }; }
                            }
                        });

                        self._trafficLightColorMap = oColorMap;
                        oLocalDataModel.setProperty("/trafficLightColumnVisible", true);
                        // Bump version so ALL formatTrafficDot formatters re-run
                        // and read the freshly updated _trafficLightColorMap.
                        var iVer = oLocalDataModel.getProperty("/trafficLightVersion") || 0;
                        oLocalDataModel.setProperty("/trafficLightVersion", iVer + 1);
                        // Re-fetch legend so the footer stays in sync with newly expanded nodes.
                        $.ajax({
                            "url": self.isRunninglocally() + "/web/?hash=" + encodeURIComponent(sHash) + "&metaTable=TrafficLightValues&requestType=getTrafficLight&trafficlightKey=" + encodeURIComponent(sKey),
                            "method": "GET",
                            "dataType": "json",
                            "success": function (getLegendResponse) {
                                var aLegendRows = [];
                                if (Array.isArray(getLegendResponse && getLegendResponse.Rows)) {
                                    aLegendRows = getLegendResponse.Rows;
                                } else if (Array.isArray(getLegendResponse && getLegendResponse.rows)) {
                                    aLegendRows = getLegendResponse.rows;
                                }
                                if (aLegendRows.length > 0) {
                                    self._updateLegendFooterFromRows(aLegendRows);
                                } else {
                                    self._updateLegendFooter();
                                }
                                self.setBusyOff();
                            },
                            "error": function () {
                                self._updateLegendFooter();
                                self.setBusyOff();
                            }
                        });
                    },
                    "error": function () {
                        // On error, bump version so existing parent dots remain visible
                        var iVer = oLocalDataModel.getProperty("/trafficLightVersion") || 0;
                        oLocalDataModel.setProperty("/trafficLightVersion", iVer + 1);
                        self.setBusyOff();
                    }
                });
            };

            if (this.hash) {
                fnCall(this.hash);
            } else {
                this.getoHashToken().done(function (result) {
                    if (result && result.hash) { fnCall(result.hash); }
                });
            }
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