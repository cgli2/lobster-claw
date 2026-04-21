/* eslint-disable no-unused-vars */
function $(selector, parent) {
  return (parent || document).querySelector(selector);
}

function $$(selector, parent) {
  return Array.from((parent || document).querySelectorAll(selector));
}

function createElement(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'textContent') {
        el.textContent = value;
      } else if (key === 'innerHTML') {
        el.innerHTML = value;
      } else if (key.startsWith('on')) {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(value)) {
          el.dataset[dk] = dv;
        }
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  if (children) {
    if (typeof children === 'string') {
      el.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (child) el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
    } else {
      el.appendChild(children);
    }
  }
  return el;
}

function show(el) {
  if (el) el.classList.remove('hidden');
}

function hide(el) {
  if (el) el.classList.add('hidden');
}

function clearChildren(el) {
  if (el) el.innerHTML = '';
}

function maskApiKey(key) {
  if (!key || key.length < 8) return '******';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
