sap.ui.define([
    "com/nexus/asset/controller/BaseController",
    "sap/m/MessageToast"
], (BaseController, MessageToast) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Detail", {
        onInit() {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.attachRoutePatternMatched(this.onRouteMatched, this);
            }
        },
        onRouteMatched: function () {
            this.setBusyOff();
        },
        onTilePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("LocalDataModel");
            if (oContext) {
                var oTileData = oContext.getObject();
                MessageToast.show("Selected: " + (oTileData.Name || ""));
            }
        }
    });
});