sap.ui.define([
  "sap/ui/core/mvc/Controller"
], (BaseController) => {
  "use strict";

  return BaseController.extend("com.nexus.asset.controller.App", {
    onInit() {
      var content = window.location.hash;
      var contentPos = content.search('/Detail');
      var iPos = content.search("/False/EndColumnFullScreen");
      if (iPos < 0 && contentPos > 0) {
        window.location.href = window.location.href.split('/Detail')[0].slice(0, -1);
      }

      this.oOwnerComponent = this.getOwnerComponent();
      this.oRouter = this.oOwnerComponent.getRouter();
      this.oRouter.attachRouteMatched(this.onRouteMatched, this);
      this.oRouter.attachBeforeRouteMatched(this.onBeforeRouteMatched, this);

      var data = oStorage.get("appSessionData");
      //console.log(data[0].TermsAndConditions); // storage
      if (content.includes("TwoColumnsMidExpanded")) {
        var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
        oRouter.navTo("Master", {
          layout: "OneColumn"
        });
      }
    },

    onBeforeRouteMatched: function (oEvent) {
      var oModel = this.getOwnerComponent().getModel();
      var sLayout = oEvent.getParameters().arguments.layout;

      if (!sLayout) {
        var oNextUIState = this.getOwnerComponent().getHelper().getNextUIState(0);
        sLayout = oNextUIState.layout;
      }

      oModel.setProperty("/layout", sLayout);
    },

    onRouteMatched: function (oEvent) {
      this.currentRouteName = oEvent.getParameter("name");
      this._updateUIElements();
    },

    onStateChanged: function (oEvent) {
      var bIsNavigationArrow = oEvent.getParameter("isNavigationArrow");
      var sLayout = oEvent.getParameter("layout");

      this._updateUIElements();

      if (bIsNavigationArrow) {
        this.oRouter.navTo(this.currentRouteName, { layout: sLayout }, true);
      }
    },

    _updateUIElements: function () {
      var oModel = this.getOwnerComponent().getModel();
      var oUIState = this.getOwnerComponent().getHelper().getCurrentUIState();
      oModel.setData(oUIState);
    },

    onExit: function () {
      this.oRouter.detachRouteMatched(this.onRouteMatched, this);
      this.oRouter.detachBeforeRouteMatched(this.onBeforeRouteMatched, this);
    }
  });
});