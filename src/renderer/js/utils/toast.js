/* eslint-disable no-unused-vars */
const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.getElementById('toast-container');
      if (!this._container) {
        this._container = createElement('div', { id: 'toast-container' });
        document.body.appendChild(this._container);
      }
      // Style the container
      Object.assign(this._container.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: STYLES.toastZIndex.toString(),
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none'
      });
    }
    return this._container;
  },

  show(message, type = 'info', duration) {
    // 使用配置中的默认值
    if (duration === undefined) {
      duration = type === 'error' ? STYLES.toastErrorDuration : STYLES.toastDuration;
    }
    
    const container = this._getContainer();
    const colors = {
      success: 'var(--success)',
      error: 'var(--danger)',
      warning: 'var(--warning)',
      info: 'var(--accent)'
    };

    const toast = createElement('div', {
      className: 'toast-item',
      textContent: message
    });

    Object.assign(toast.style, {
      padding: '10px 20px',
      background: 'var(--bg-secondary)',
      border: `1px solid ${colors[type] || colors.info}`,
      borderLeft: `4px solid ${colors[type] || colors.info}`,
      borderRadius: 'var(--radius)',
      color: 'var(--text-primary)',
      fontSize: '13px',
      boxShadow: 'var(--shadow-lg)',
      pointerEvents: 'auto',
      opacity: '0',
      transform: 'translateX(30px)',
      transition: 'all 0.3s ease',
      maxWidth: '360px'
    });

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // Remove after duration
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  success(message) { this.show(message, 'success'); },
  error(message) { this.show(message, 'error'); },
  warning(message) { this.show(message, 'warning'); },
  info(message) { this.show(message, 'info'); }
};
