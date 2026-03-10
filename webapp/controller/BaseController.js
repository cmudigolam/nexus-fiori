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
            if (!sHost.includes("localhost"))
                var Prefix = this.getCompleteURL();
            else var Prefix = "";
            return Prefix;
        },

        fetchDetailTiles: function (sCtId, sCompoonentID, hash) {
            this.setBusyOn();
            var oLocalDataModel = this.getLocalDataModel();
            var self = this;
            $.ajax({
                url:  self.isRunninglocally()+ "/bo/Info_Def/",
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
                        url:  self.isRunninglocally()+ "/bo/Table_Def/",
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
        getoHashToken: function () {
            var self = this;
            return $.ajax({
                // 
                "url":  self.isRunninglocally()+ "/security/login",
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