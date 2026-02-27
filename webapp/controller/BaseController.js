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

        fetchDetailTiles: function (sCtId, sCompoonentID, hash) {
            this.setBusyOn();
            var oLocalDataModel = this.getLocalDataModel();
            var iconList = this.getSapIcons();
            $.ajax({
                url: "/bo/Info_Def/",
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
                    if (oLocalDataModel.getProperty("/sCompoonentID")) {
                        oLocalDataModel.setProperty("/shareUrl", "https://trial.nexusic.com/?searchKey=Asset&searchValue=" + sCompoonentID);
                    } else {
                        oLocalDataModel.setProperty("/shareUrl", "Share / Navigate");
                    }

                    // Second service call: get table definitions by TD_IDs
                    $.ajax({
                        url: "/bo/Table_Def/",
                        method: "GET",
                        dataType: "json",
                        headers: {
                            "X-NEXUS-Filter": '{"where":[{"field":"TD_ID","method":"in","items":[' + aTdIds.join(",") + ']}]}'
                        },
                        data: {
                            hash: hash
                        },
                        success: function (response2) {
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
            return $.ajax({
                //this.getCompleteURL() + 
                "url": "/security/login",
                "method": "GET",
                "success": function (result, xhr, successData) {
                    this.getLocalDataModel().setProperty("/HashToken", result.hash);
                }.bind(this),
                "error": function (errorData) {
                    debugger
                }.bind(this)
            });
        },
        getSapIcons: function () {
            return [
                "sap-icon://checklist",
                "sap-icon://detail-more",
                "sap-icon://checklist-item",
                "sap-icon://cart",
                "sap-icon://donut-chart",
                "sap-icon://group-2",
                "sap-icon://horizontal-bar-chart",
                "sap-icon://line-chart",
                "sap-icon://multi-select",
                "sap-icon://multiselect-all",
                "sap-icon://pie-chart",
                "sap-icon://tree",
                "sap-icon://trip-report",
                "sap-icon://mirrored-task-circle-2",
                "sap-icon://appear-offline",
                "sap-icon://arrow-down",
                "sap-icon://customer",
                "sap-icon://lead-outdated",
                "sap-icon://sys-help",
                "sap-icon://customer-financial-fact-sheet",
                "sap-icon://customer-history",
                "sap-icon://customer-order-entry",
                "sap-icon://e-care",
                "sap-icon://employee-lookup",
                "sap-icon://group",
                "sap-icon://person-placeholder",
                "sap-icon://private",
                "sap-icon://role",
                "sap-icon://open-folder",
                "sap-icon://permission",
                "sap-icon://popup-window",
                "sap-icon://key-user-settings",
                "sap-icon://card",
                "sap-icon://user-settings",
                "sap-icon://decline",
                "sap-icon://message-success",
                "sap-icon://message-error",
                "sap-icon://message-warning",
                "sap-icon://message-information",
                "sap-icon://locked",
                "sap-icon://unlocked",
                "sap-icon://key",
                "sap-icon://chain-link",
                "sap-icon://link",
                "sap-icon://chain",
                "sap-icon://paper-plane",
                "sap-icon://email",
                "sap-icon://phone",
                "sap-icon://iphone",
                "sap-icon://ipad",
                "sap-icon://desktop",
                "sap-icon://laptop",
                "sap-icon://display",
                "sap-icon://save",
                "sap-icon://download",
                "sap-icon://upload",
                "sap-icon://cloud",
                "sap-icon://cloud-upload",
                "sap-icon://cloud-download",
                "sap-icon://database",
                "sap-icon://table-view",
                "sap-icon://list",
                "sap-icon://grid",
                "sap-icon://menu",
                "sap-icon://menu2",
                "sap-icon://menu3",
                "sap-icon://menu4",
                "sap-icon://menu5",
                "sap-icon://menu6",
                "sap-icon://menu7",
                "sap-icon://menu8",
                "sap-icon://menu9"
            ];
        }
    });
});