/* eslint-disable no-unused-vars, no-undef */
const AppController = {
  _wizardView: null,
  _dashboardView: null,

  async init() {
    this._wizardView = $('#wizard-view');
    this._dashboardView = $('#dashboard-view');

    console.log('AppController.init() called');

    // 检测是否已安装 OpenClaw
    try {
      const version = await window.openclawAPI.install.getVersion();
      console.log('Detected version:', version);
      if (version) {
        // 已安装，直接进入管理面板
        this.showDashboard(version);
      } else {
        // 未安装，显示安装向导
        this.showWizard();
      }
    } catch (err) {
      console.error('Version check failed:', err);
      this.showWizard();
    }
  },

  showWizard() {
    console.log('AppController.showWizard() started');
    
    try {
      console.log('1. Showing wizard view');
      show(this._wizardView);
      
      console.log('2. Hiding dashboard view');
      hide(this._dashboardView);
      
      console.log('3. Resetting DashboardController');
      DashboardController.reset();
      
      console.log('4. Initializing WizardController');
      WizardController.init(() => {
        console.log('WizardController finished callback');
        hide(this._wizardView);
        show(this._dashboardView);
        window.openclawAPI.install.getVersion().then(v => {
          DashboardController.init(v || '');
        });
      });
      
      console.log('5. WizardController initialization complete');
    } catch (err) {
      console.error('Error in showWizard():', err);
    }
  },

  showDashboard(version) {
    hide(this._wizardView);
    show(this._dashboardView);
    DashboardController.init(version);
  },

  /** Called from dashboard when user wants to reinstall */
  switchToWizard() {
    this.showWizard();
  }
};

// Boot
AppController.init();
