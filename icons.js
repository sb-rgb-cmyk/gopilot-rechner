(function initGoPilotIcons() {
  const ICON_SHAPES = {
    calculator: [
      ['path', { d: 'M8 5h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z' }],
      ...['M9 9h6', 'M9 13h.01', 'M12 13h.01', 'M15 13h.01', 'M9 16h.01', 'M12 16h.01', 'M15 16h.01'].map(d => ['path', { d }])
    ],
    check: [['path', { d: 'M5 12.5l4 4L19 7' }]],
    close: [['path', { d: 'M7 7l10 10' }], ['path', { d: 'M17 7L7 17' }]],
    collapse: [['path', { d: 'M8 12h8' }]],
    copy: [['path', { d: 'M8 8h10v10H8z' }], ['path', { d: 'M6 14H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1' }]],
    error: [['path', { d: 'M12 6v8' }], ['path', { d: 'M12 18h.01' }]],
    expand: [['path', { d: 'M8 8h8v8H8z' }]],
    lock: [['rect', { x: '6', y: '10', width: '12', height: '10', rx: '2' }], ['path', { d: 'M8 10V8a4 4 0 0 1 8 0v2' }]],
    pending: [['path', { d: 'M7 12h.01' }], ['path', { d: 'M12 12h.01' }], ['path', { d: 'M17 12h.01' }]]
  };

  function attributes(options) {
    const classes = ['gopilot-icon', options.className]
      .filter(Boolean)
      .join(' ');
    const strokeWidth = Number.isFinite(options.strokeWidth) ? options.strokeWidth : 2;
    return { class: classes, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', fill: 'none',
      stroke: 'currentColor', 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  }

  function render(name, options = {}) {
    if (!Object.hasOwn(ICON_SHAPES, name)) return '';
    const serialize = values => Object.entries(values).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(' ');
    const paths = ICON_SHAPES[name].map(([tag, values]) => `<${tag} ${serialize(values)}/>`).join('');
    return `<svg ${serialize(attributes(options))}>${paths}</svg>`;
  }

  function create(name, options = {}, rootDocument = document) {
    if (!Object.hasOwn(ICON_SHAPES, name)) return null;
    const svg = rootDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.entries(attributes(options)).forEach(([key, value]) => svg.setAttribute(key, value));
    for (const [tag, values] of ICON_SHAPES[name]) {
      const node = rootDocument.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(values).forEach(([key, value]) => node.setAttribute(key, value));
      svg.appendChild(node);
    }
    return svg;
  }

  function escapeAttribute(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  globalThis.goPilotIcons = {
    render,
    create
  };
})();
