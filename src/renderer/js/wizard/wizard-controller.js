/* eslint-disable no-unused-vars, no-undef */
const WizardController = {
  _currentStep: 0,
  _steps: [StepWelcome, StepCheck, StepInstall, StepConfigure, StepComplete],
  _onFinishCallback: null,
  _executionMode: 'native',

  init(onFinish) {
    console.log('WizardController.init() started');
    this._onFinishCallback = onFinish;
    this._currentStep = 0;
    this._executionMode = 'native';
    
    console.log('About to render first step...');
    this._renderStep();
    console.log('First step rendered');
  },

  next() {
    if (this._currentStep < this._steps.length - 1) {
      this._currentStep++;
      this._renderStep();
    }
  },

  prev() {
    if (this._currentStep > 0) {
      this._currentStep--;
      this._renderStep();
    }
  },

  finish() {
    if (this._onFinishCallback) {
      this._onFinishCallback();
    }
  },

  setExecutionMode(mode) {
    this._executionMode = mode;
  },

  getExecutionMode() {
    return this._executionMode;
  },

  _renderStep() {
    console.log('WizardController._renderStep() started');
    
    const container = $('#wizard-content');
    if (!container) {
      console.error('ERROR: #wizard-content not found!');
      return;
    }
    console.log('#wizard-content found');

    // Update sidebar indicators
    try {
      $$('.wizard-sidebar .step-item').forEach((item, idx) => {
        item.classList.remove('active', 'completed');
        if (idx < this._currentStep) {
          item.classList.add('completed');
        } else if (idx === this._currentStep) {
          item.classList.add('active');
        }
      });
      console.log('Sidebar indicators updated');
    } catch (err) {
      console.error('Error updating sidebar:', err);
    }

    // Render step content
    const step = this._steps[this._currentStep];
    console.log('Current step:', this._currentStep, 'Step object:', step);
    
    if (step && step.render) {
      console.log('Calling step.render()...');
      try {
        step.render(container);
        console.log('step.render() completed successfully');
      } catch (err) {
        console.error('ERROR in step.render():', err);
      }
    } else {
      console.error('ERROR: step not found or step.render is not a function');
    }
    
    console.log('WizardController._renderStep() finished');
  }
};
