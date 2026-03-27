sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/m/MessageBox"
], function (Controller, UIComponent, MessageBox) {
    "use strict";

    return Controller.extend("com.nexus.asset.controller.BaseController", {
        onInit: function () {
            this.getRouter().attachRoutePatternMatched(this.onRouteMatched, this);
        },
        displayErrorMessageWithAction: function (errorString, onCloseFunction) {
            MessageBox.show(
                errorString, {
                icon: sap.m.MessageBox.Icon.ERROR,
                title: "Error",
                actions: [sap.m.MessageBox.Action.OK],
                onClose: onCloseFunction,
                styleClass: "sapUiSizeCompact buttonBlack"
            }
            );
        },
        displayInfoMessageWithAction: function (infoString, onCloseFunction) {

            MessageBox.show(
                infoString, {
                icon: sap.m.MessageBox.Icon.INFORMATION,
                title: "Information",
                actions: [sap.m.MessageBox.Action.OK],
                onClose: onCloseFunction,
                styleClass: "sapUiSizeCompact buttonBlack"
            }
            );
        },
        getRouter: function () {
            return UIComponent.getRouterFor(this);
        },

        getResourceBundle: function () {
            var oResourceBundle = this.getOwnerComponent().getModel("i18n")._oResourceBundle;
            return oResourceBundle;
        },

        getModel: function (sName) {
            if (sName) {
                return this.getOwnerComponent().getModel(sName);
            } else {
                return this.getOwnerComponent().getModel();
            }
        },

        getLocalDataModel: function () {
            return this.getOwnerComponent().getModel("LocalDataModel");
        },

        getApplicationID: function () {
            return this.getOwnerComponent().getManifestEntry("/sap.app").id.replaceAll(".", "");
        },

        getApplicationVersion: function () {
            return this.getOwnerComponent().getManifestEntry("/sap.app").applicationVersion.version;
        },

        getApplicationRouter: function () {
            return "/" + this.getOwnerComponent().getManifestEntry("/sap.cloud").service;
        },
        getCompleteURL: function () {
            return this.getApplicationRouter() + "." + this.getApplicationID() + "-" + this.getApplicationVersion();
        },
        setBusyOn: function () {
            window.appView.setBusyIndicatorDelay(0);
            window.appView.setBusy(true);
        },
        setBusyOff: function () {
            window.appView.setBusy(false);
        },
        isRunninglocally: function () {
            var sHost = window.location.host;
            if (!sHost.includes("localhost") && !sHost.includes("port"))
                var Prefix = this.getCompleteURL();
            else var Prefix = "";
            return Prefix;
        },

        /**
         * Normalize Full_Location property from various casing variants
         * @param {Object} oNode - Node object
         * @returns {String} Normalized Full_Location value
         */
        _getFullLocation: function(oNode) {
            if (!oNode) return "";
            if (oNode.Full_Location) return oNode.Full_Location;
            if (oNode.Full_location) return oNode.Full_location;
            if (oNode.full_location) return oNode.full_location;
            if (oNode.FullLocation) return oNode.FullLocation;
            return "";
        },

        /**
         * Get path segments from a full location string
         * Splits "Parent / Child / Leaf" into ["Parent", "Child", "Leaf"]
         * @param {String} sFullLocation - Full location path
         * @returns {Array} Array of path segments
         */
        _getPathSegments: function(sFullLocation) {
            if (!sFullLocation) {
                return [];
            }
            return sFullLocation.split(" / ");
        },

        /**
         * Build breadcrumb array from a full location path
         * @param {String} sFullLocation - Full location path (e.g., "Parent / Child / Leaf")
         * @returns {Array} Array of breadcrumb objects {name, fullLocation}
         */
        _buildBreadcrumbSegments: function(sFullLocation) {
            var aBreadcrumb = [];
            
            if (!sFullLocation) {
                return aBreadcrumb;
            }
            
            var segments = this._getPathSegments(sFullLocation);
            
            // Use array.slice().join() instead of string concatenation (O(n) vs O(n²))
            segments.forEach(function(segment, index) {
                var sFullPath = segments.slice(0, index + 1).join(" / ");
                aBreadcrumb.push({
                    name: segment,
                    fullLocation: sFullPath
                });
            });
            
            return aBreadcrumb;
        },

        fetchSettings: function (hash) {
            var self = this;
            var oDeferred = $.Deferred();
            $.ajax({
                url: self.getCompleteURL() + "/setting/",
                method: "GET",
                dataType: "json",
                data: {
                    hash: hash
                },
                success: function (response) {
                    var aRows = Array.isArray(response) ? response : (response && Array.isArray(response.rows) ? response.rows : []);
                    // Find the AigOrdering row and parse its value JSON
                    var oOrderingRow = aRows.find(function (r) { return r.identifier === "AigOrdering"; });
                    if (oOrderingRow && oOrderingRow.value && typeof oOrderingRow.value === "string") {
                        try {
                            var aParsed = JSON.parse(oOrderingRow.value);
                            if (Array.isArray(aParsed)) {
                                oDeferred.resolve(aParsed);
                                return;
                            }
                        } catch (e) {
                            console.error("Error parsing AigOrdering value:", e);
                        }
                    }
                    oDeferred.resolve(null);
                },
                error: function (xhr, status, error) {
                    self.setBusyOff();
                    if (xhr.status === 404) {
                        console.warn("Settings endpoint not available (404). Using default sorting.", error);
                    } else {
                        console.error("Error while fetching settings:", error);
                    }
                    oDeferred.resolve(null);
                }
            });
            return oDeferred.promise();
        },

        sortTilesBySettings: function (aTiles, aSettings) {
            if (!Array.isArray(aSettings) || aSettings.length === 0) {
                return aTiles;
            }

            // Normalize: remove all spaces for matching
            function normalize(s) {
                return String(s || "").replace(/\s+/g, "").toLowerCase();
            }

            // Build Order lookup from settings keyed by normalized Name
            var oOrderMap = {};
            aSettings.forEach(function (oSetting) {
                if (oSetting.Name != null && oSetting.Order != null) {
                    oOrderMap[normalize(oSetting.Name)] = Number(oSetting.Order);
                }
            });

            // Sort tiles ascending by Order, tiles not in settings go to the end
            return aTiles.slice().sort(function (a, b) {
                var nOrderA = oOrderMap.hasOwnProperty(normalize(a.Name)) ? oOrderMap[normalize(a.Name)] : Number.MAX_VALUE;
                var nOrderB = oOrderMap.hasOwnProperty(normalize(b.Name)) ? oOrderMap[normalize(b.Name)] : Number.MAX_VALUE;
                return nOrderA - nOrderB;
            });
        },

        fetchDetailTiles: function (sCtId, sCompoonentID, hash) {
            this.setBusyOn();
            var oLocalDataModel = this.getLocalDataModel();
            var self = this;
            $.ajax({
                url: self.getCompleteURL()+ "/bo/Info_Def/",
                method: "GET",
                dataType: "json",
                headers: {
                    "X-NEXUS-Filter": '{"where":[{"field":"CT_ID","method":"eq","value":"' + sCtId + '"}]}'
                },
                data: {
                    hash: hash
                },
                success: function (response1) {
                    var aRows = Array.isArray(response1 && response1.rows) ? response1.rows : [];
                    var aTdIds = aRows.map(function (row) {
                        return row.TD_ID;
                    }).filter(function (id) {
                        return id !== undefined && id !== null;
                    });
                    var oNextUIState = this.getOwnerComponent().getHelper().getNextUIState(1);
                    if (aTdIds.length === 0) {
                        oLocalDataModel.setProperty("/detailTiles", []);
                        oLocalDataModel.setProperty("/detailTileGroups", []);
                        this.setBusyOff();
                        this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
                        this.getRouter().navTo("Detail", { layout: oNextUIState.layout });
                        return;
                    }

                    // Update share URL in model for tooltip binding
                    var oSelectedNodeData = oLocalDataModel.getProperty("/selectedNodeData");
                    var sVnId = oSelectedNodeData && oSelectedNodeData.VN_ID;
                    if (sVnId) {
                        oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sVnId);
                    } else {
                        oLocalDataModel.setProperty("/shareUrl", "Share / Navigate");
                    }

                    // Second service call: get table definitions by TD_IDs
                    $.ajax({
                        url:  self.getCompleteURL()+ "/bo/Table_Def/",
                        method: "GET",
                        dataType: "json",
                        headers: {
                            "X-NEXUS-Filter": '{"where":[{"field":"TD_ID","method":"in","items":[' + aTdIds.join(",") + ']}]}'
                        },
                        data: {
                            hash: hash
                        },
                        success: function (response2) {
                            var aTiles = (Array.isArray(response2 && response2.rows) ? response2.rows : [])
                                .reduce(function(aTiles, oTile) {
                                    if (oTile.DT_ID === 1) {
                                        aTiles.push(oTile);
                                    }
                                    return aTiles;
                                }, []);

                            // Fetch settings and sort tiles by Order (ascending)
                            self.fetchSettings(hash).done(function (aSettings) {
                                if (aSettings) {
                                    // Filter settings by matching AssetType to current tiles
                                    var fnNorm = function (s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); };
                                    var aTileKeys = aTiles.map(function (t) { return fnNorm(t.Name); });
                                    var oAssetGroups = {};
                                    aSettings.forEach(function (s) {
                                        var sAt = s.AssetType || "";
                                        if (!oAssetGroups[sAt]) oAssetGroups[sAt] = [];
                                        oAssetGroups[sAt].push(s);
                                    });
                                    // Pick AssetType with most tile name matches
                                    var sBestType = "";
                                    var nBestCount = 0;
                                    Object.keys(oAssetGroups).forEach(function (sAt) {
                                        var nCount = oAssetGroups[sAt].filter(function (s) {
                                            return aTileKeys.indexOf(fnNorm(s.Name)) !== -1;
                                        }).length;
                                        if (nCount > nBestCount) {
                                            nBestCount = nCount;
                                            sBestType = sAt;
                                        }
                                    });
                                    var aFiltered = sBestType ? oAssetGroups[sBestType] : aSettings;
                                    aTiles = self.sortTilesBySettings(aTiles, aFiltered);
                                } else {
                                    // Fallback to Name sorting if settings are not available
                                    aTiles = aTiles.sort(function(a, b) {
                                        var nameA = (a.Name || "").toLowerCase();
                                        var nameB = (b.Name || "").toLowerCase();
                                        if (nameA < nameB) return -1;
                                        if (nameA > nameB) return 1;
                                        return 0;
                                    });
                                }

                                var oCategoryMap = {};
                                aTiles.forEach(function (oTile) {
                                    var sCategory = oTile.Category || oTile.category || "Uncategorized";
                                    if (!oCategoryMap[sCategory]) {
                                        oCategoryMap[sCategory] = [];
                                    }
                                    oCategoryMap[sCategory].push(oTile);
                                });
                                var aEffective = aSettings ? aFiltered : [];
                                // Sort categories by the minimum tile Order within each category
                                var fnNormCat = function (s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); };
                                var oSettingsOrderMap = {};
                                if (Array.isArray(aEffective) && aEffective.length > 0) {
                                    aEffective.forEach(function (oSetting) {
                                        if (oSetting.Name != null && oSetting.Order != null) {
                                            oSettingsOrderMap[fnNormCat(oSetting.Name)] = Number(oSetting.Order);
                                        }
                                    });
                                }
                                var aCategoryKeys = Object.keys(oCategoryMap);
                                aCategoryKeys.sort(function (catA, catB) {
                                    // Find minimum tile order in each category
                                    var nMinA = Number.MAX_VALUE;
                                    oCategoryMap[catA].forEach(function (t) {
                                        var nOrd = oSettingsOrderMap[fnNormCat(t.Name)];
                                        if (nOrd !== undefined && nOrd < nMinA) nMinA = nOrd;
                                    });
                                    var nMinB = Number.MAX_VALUE;
                                    oCategoryMap[catB].forEach(function (t) {
                                        var nOrd = oSettingsOrderMap[fnNormCat(t.Name)];
                                        if (nOrd !== undefined && nOrd < nMinB) nMinB = nOrd;
                                    });
                                    if (nMinA !== nMinB) return nMinA - nMinB;
                                    // Fallback to alphabetical if same order
                                    return catA.localeCompare(catB);
                                });
                                var aTileGroups = aCategoryKeys.map(function (sCategory) {
                                    return {
                                        Category: sCategory,
                                        tiles: self.sortTilesBySettings(oCategoryMap[sCategory], aEffective)
                                    };
                                });
                                oLocalDataModel.setProperty("/detailTiles", aTiles);
                                oLocalDataModel.setProperty("/detailTileGroups", aTileGroups);
                                this.setBusyOff();
                                this.getRouter()._oRoutes.Detail._oConfig.layout = "TwoColumnsMidExpanded";
                                this.getRouter().navTo("Detail", { layout: oNextUIState.layout });
                            }.bind(this));
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
        getoHashToken: function () {
            var self = this;
            return $.ajax({
                // self.getCompleteURL()+ 
                "url":  self.getCompleteURL()+ "/security/login",
                "method": "GET",
                "success": function (result, xhr, successData) {
                    this.getLocalDataModel().setProperty("/HashToken", result.hash);
                }.bind(this),
                "error": function (errorData) {
                    this.setBusyOff();
                    MessageBox.error("Error on Login")
                }.bind(this)
            });
        },
        getSapIcons: function () {
            // Only non-component type icons (actions, statuses, devices, etc.)
            return [
                "sap-icon://cloud",
                "sap-icon://key",
                "sap-icon://calendar",
                "sap-icon://history",
                "sap-icon://flag",
                "sap-icon://calendar-appointment",
                "sap-icon://calendar-triangle",
                "sap-icon://map",
                "sap-icon://world",
                "sap-icon://present",
                "sap-icon://shipping-status",
                "sap-icon://travel-request",
                "sap-icon://umbrella",
                "sap-icon://weather-proofing",
                "sap-icon://heating-cooling",
                "sap-icon://nutrition-activity",
                "sap-icon://insurance-house",
                "sap-icon://insurance-life",
                "sap-icon://insurance-car",
                "sap-icon://badge",
                "sap-icon://bookmark",
                "sap-icon://building",
                "sap-icon://business-card",
                "sap-icon://certificate",
                "sap-icon://cloudy",
                "sap-icon://contacts",
                "sap-icon://credit-card",
                "sap-icon://customer-view",
                "sap-icon://factory",
                "sap-icon://family-care",
                "sap-icon://fax",
                "sap-icon://globe",
                "sap-icon://hospital",
                "sap-icon://lab",
                "sap-icon://leads",
                "sap-icon://map-2",
                "sap-icon://milestone",
                "sap-icon://money-bills",
                "sap-icon://notes",
                "sap-icon://official-service",
                "sap-icon://outbox",
                "sap-icon://passenger-train",
                "sap-icon://payment-approval",
                "sap-icon://person-placeholder",
                "sap-icon://pharmacy",
                "sap-icon://pool",
                "sap-icon://post",
                "sap-icon://receipt",
                "sap-icon://retail-store",
                "sap-icon://stethoscope",
                "sap-icon://suitcase",
                "sap-icon://tag",
                "sap-icon://taxi",
                "sap-icon://temperature",
                "sap-icon://toaster",
                "sap-icon://travel-expense",
                "sap-icon://truck-load",
                "sap-icon://wallet"
            ];
        }
    });
});