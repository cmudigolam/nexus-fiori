sap.ui.define([
    "com/nexus/asset/controller/BaseController"
], (BaseController) => {
    "use strict";

    return BaseController.extend("com.nexus.asset.controller.Dashboard", {
        onInit() {
            var oRouter = this.getRouter();
            if (oRouter) {
                oRouter.attachRoutePatternMatched(this.onRouteMatched, this);
            }
        },
        onRouteMatched: function () {
            this.setBusyOff();
        },
        onPressAssetHierarchyTile: function () {
            var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
            oRouter.navTo("Master", {
                layout: "TwoColumnsMidExpanded"
            });
        },
    });
});