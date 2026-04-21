/* eslint-disable no-unused-vars, no-undef */
const StepWelcome = {
  render(container) {
    console.log('StepWelcome.render() started');
    
    try {
      clearChildren(container);
      console.log('container cleared');

      const features = TEXT.WIZARD_WELCOME_FEATURES.map(f =>
        `<li>${f}</li>`
      ).join('');
      console.log('features HTML generated');

      container.innerHTML = `
        <h2>${TEXT.WIZARD_WELCOME_TITLE}</h2>
        <p class="step-desc">${TEXT.WIZARD_WELCOME_DESC}</p>
        <div class="card" style="margin-bottom: 24px;">
          <h3 style="margin-bottom: 12px;">主要功能</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${TEXT.WIZARD_WELCOME_FEATURES.map(f => `
              <li style="padding: 8px 0; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px;">
                <span style="color: var(--accent); font-size: 16px;">&#10003;</span>
                <span>${f}</span>
              </li>
            `).join('')}
          </ul>
        </div>
        <div class="wizard-actions">
          <div></div>
          <button class="btn btn-primary btn-lg" id="wizard-start-btn">${TEXT.WIZARD_WELCOME_START}</button>
        </div>
      `;
      console.log('container.innerHTML set successfully');

      console.log('About to add event listener to #wizard-start-btn');
      $('#wizard-start-btn').addEventListener('click', () => {
        console.log('#wizard-start-btn clicked');
        WizardController.next();
      });
      console.log('Event listener added successfully');
      
      console.log('StepWelcome.render() finished successfully');
    } catch (err) {
      console.error('ERROR in StepWelcome.render():', err);
    }
  }
};
