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
        }

    });
});