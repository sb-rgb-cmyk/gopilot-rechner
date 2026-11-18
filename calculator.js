(function initGoPilotCalculator() {
  const core = globalThis.goPilotCalculatorCore;
  const STYLE_STORAGE_KEY = 'goPilotStylePresetMode';
  const CALCULATOR_STATE_STORAGE_KEY = 'goPilotCalculatorState';
  const CALCULATOR_STATE_VERSION = 1;
  const TWENTY_MINUTES_MODE = 'twenty-minutes';
  const RABATT_LOCK_FIELDS = ['brutto', 'rabatt', 'kundennetto', 'agenturnetto', 'netto', 'mwst'];
  const FLIGHT_PRICE_FIELDS = ['brutto', 'rabatt', 'kundennetto', 'agenturnetto', 'netto', 'bk', 'dbe'];
  const PRICE_LOCK_LABELS = {
    brutto: 'Brutto',
    rabatt: 'Rabatt',
    kundennetto: 'Kundennetto',
    agenturnetto: 'Agenturnetto',
    netto: 'Netto',
    mwst: 'Netto inkl. MwSt.'
  };
  const PRICE_LOCK_CONFIG = {
    r: { scope: 'rabatt', fields: RABATT_LOCK_FIELDS, stateKey: 'rabattLockedField', editedKey: 'lastEditedRabattField' },
    h: { scope: 'hosting', fields: RABATT_LOCK_FIELDS.filter(field => field !== 'mwst'), stateKey: 'hostingLockedField', editedKey: 'lastEditedHostingField' }
  };
  const STATIC_INPUT_IDS = [
    'r-brutto',
    'r-rabatt',
    'r-kundennetto',
    'r-agenturnetto',
    'r-bk',
    'r-dbe',
    'r-netto',
    'r-mwst',
    'r-mwst-amount',
    'h-budget',
    'h-brutto',
    'h-rabatt',
    'h-kundennetto',
    'h-agenturnetto',
    'h-bk',
    'h-dbe',
    'h-netto',
    'h-host-tkp',
    'h-prod',
    'v-total',
    'v-text'
  ];
  const STATIC_CHECKBOX_IDS = [
    'r-use-bk',
    'r-use-dbe',
    'r-use-mwst',
    'h-use-bk',
    'h-use-dbe',
    'v-use-advanced',
    'v-use-extra-dependency'
  ];
  const pendingCopyRequests = new Map();
  let saveTimer = null;
  let isRestoringState = false;
  let pendingDocumentImport = null;
  let documentImportPlan = null;
  let documentImportUndo = null;
  const state = {
    activeTab: 'rabatt',
    anchors: {
      h: 'rabatt',
      r: 'rabatt'
    },
    solveBruttoFromRabatt: {
      h: false,
      r: false
    },
    rabattLockedField: '',
    lastEditedRabattField: '',
    hostingLockedField: '',
    lastEditedHostingField: '',
    flights: [{ name: 'Flight A', pct: 50 }, { name: 'Flight B', pct: 50 }],
    hostingDocumentSource: null,
    distribution: createDefaultDistributionState()
  };

  document.addEventListener('DOMContentLoaded', init);
  async function init() {

    document.querySelectorAll('.tab').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.tab));
    });
    document.addEventListener('click', handleCopyButtonClick);
    document.addEventListener('focusin', handleNumericInputFocus);
    document.addEventListener('input', scheduleStateSave);
    document.addEventListener('change', scheduleStateSave);
    document.addEventListener('click', scheduleStateSave);

    bindPriceInputs('r', renderRabatt);
    bindPriceLockControls('r', renderRabatt);
    byId('r-use-mwst').addEventListener('change', () => {
      if (!byId('r-use-mwst').checked && state.anchors.r === 'mwst') {
        state.anchors.r = 'rabatt';
        state.solveBruttoFromRabatt.r = false;
      }
      renderRabatt();
    });
    byId('r-mwst').addEventListener('input', renderRabatt);
    byId('r-reset').addEventListener('click', resetRabattValues);
    byId('r-mwst-amount').addEventListener('input', () => {
      const input = byId('r-mwst-amount');
      input.classList.remove('computed');
      state.lastEditedRabattField = 'mwst';

      if (input.value.trim()) {
        byId('r-use-mwst').checked = true;
        state.anchors.r = 'mwst';
        state.solveBruttoFromRabatt.r = shouldSolveBruttoFromRabattForVatTarget();
      } else if (state.anchors.r === 'mwst') {
        state.anchors.r = 'rabatt';
        state.solveBruttoFromRabatt.r = false;
      }
      renderRabatt();
    });
    bindPriceInputs('h', renderHosting);
    bindPriceLockControls('h', renderHosting);
    ['h-budget', 'h-host-tkp', 'h-prod'].forEach(id => {
      byId(id).addEventListener('input', renderHosting);
    });
    byId('add-flight').addEventListener('click', addFlight);
    bindDistributionControls();

    switchTab(state.activeTab);
    renderFlights();
    renderHosting();
    renderRabatt();
    renderDistribution();
    scheduleStateSave();
  }

  function createDefaultDistributionState() {
    return {
      dimensions: [
        { name: 'Device Category', positions: [{ name: 'Desktop', pct: 20 }, { name: 'Mobile', pct: 80 }] },
        { name: 'Platform', positions: [{ name: 'DE', pct: 70 }, { name: 'FR', pct: 30 }] },
        { name: 'Werbemittel', positions: [{ name: 'Halfpage', pct: 60 }, { name: 'Rectangle Mobile', pct: 40 }] }
      ],
      dependencySourceIndex: 2,
      dependencyTargetIndex: 0,
      dependencyMap: {},
      extraDependencyTargetIndex: 1,
      extraDependencyMap: {},
      useExtraDependency: false,
      useAdvanced: false
    };
  }

  function handleNumericInputFocus(event) {
    const input = event.target;
    if (!isSelectableNumericInput(input)) return;
    requestAnimationFrame(() => {
      if (document.activeElement === input) input.select();
    });
  }

  function isSelectableNumericInput(input) {
    return input instanceof HTMLInputElement
      && input.getAttribute('inputmode') === 'decimal'
      && !input.readOnly
      && !input.disabled;
  }

  async function initializeStylePreset() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      const result = await chrome.storage.local.get(STYLE_STORAGE_KEY);
      applyStylePreset(result[STYLE_STORAGE_KEY]);
    } catch (error) {
      applyStylePreset('twenty-minutes');
    }
  }

  function applyStylePreset(mode) {
    document.documentElement.dataset.stylePreset = mode === 'context'
      ? 'context'
      : TWENTY_MINUTES_MODE;
  }

  async function restoreCalculatorState() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      const result = await chrome.storage.local.get(CALCULATOR_STATE_STORAGE_KEY);
      const savedState = result[CALCULATOR_STATE_STORAGE_KEY];
      if (!isValidSavedState(savedState)) return;

      isRestoringState = true;
      applySavedState(savedState);
    } catch (error) {
      // Keep calculator defaults when stored data cannot be read.
    } finally {
      isRestoringState = false;
    }
  }

  function isValidSavedState(savedState) {
    return savedState
      && typeof savedState === 'object'
      && savedState.version === CALCULATOR_STATE_VERSION;
  }

  function applySavedState(savedState) {
    if (typeof savedState.activeTab === 'string') {
      state.activeTab = ['rabatt', 'hosting', 'verteilung'].includes(savedState.activeTab)
        ? savedState.activeTab
        : 'rabatt';
    }
    if (savedState.anchors && typeof savedState.anchors === 'object') {
      state.anchors = {
        ...state.anchors,
        ...savedState.anchors
      };
    }
    if (savedState.solveBruttoFromRabatt && typeof savedState.solveBruttoFromRabatt === 'object') {
      state.solveBruttoFromRabatt = {
        ...state.solveBruttoFromRabatt,
        ...savedState.solveBruttoFromRabatt
      };
    }
    Object.entries(PRICE_LOCK_CONFIG).forEach(([prefix, config]) => {
      state[config.stateKey] = normalizePriceLockedField(prefix, savedState[config.stateKey]);
      state[config.editedKey] = normalizePriceLockedField(prefix, savedState[config.editedKey]) || state[config.stateKey];
    });
    if (Array.isArray(savedState.flights) && savedState.flights.length) {
      state.flights = savedState.flights
        .filter(flight => flight && typeof flight === 'object')
        .map(flight => ({
          name: String(flight.name ?? ''),
          pct: core.parseNumber(flight.pct),
          pricing: normalizeFlightPricing(flight.pricing),
          documentPosition: normalizeDocumentPosition(flight.documentPosition)
        }));
    }
    state.hostingDocumentSource = normalizeDocumentSource(savedState.hostingDocumentSource);
    if (savedState.distribution && typeof savedState.distribution === 'object') {
      state.distribution = normalizeSavedDistribution(savedState.distribution);
    }

    Object.entries(savedState.inputs || {}).forEach(([id, value]) => {
      const input = byId(id);
      if (!input) return;
      input.value = String(value ?? '');
    });
    Object.entries(savedState.checkboxes || {}).forEach(([id, value]) => {
      const input = byId(id);
      if (!input) return;
      input.checked = Boolean(value);
    });
  }

  function normalizeSavedDistribution(distribution) {
    const fallback = createDefaultDistributionState();
    const dimensions = Array.isArray(distribution.dimensions) && distribution.dimensions.length
      ? distribution.dimensions.map((dimension, dimensionIndex) => ({
        name: String(dimension?.name ?? `Dimension ${dimensionIndex + 1}`),
        positions: Array.isArray(dimension?.positions) && dimension.positions.length
          ? dimension.positions.map((position, positionIndex) => ({
            name: String(position?.name ?? `Position ${positionIndex + 1}`),
            pct: core.parseNumber(position?.pct)
          }))
          : [{ name: 'A', pct: 100 }]
      }))
      : fallback.dimensions;

    return {
      dimensions,
      dependencySourceIndex: Number.isFinite(distribution.dependencySourceIndex)
        ? distribution.dependencySourceIndex
        : fallback.dependencySourceIndex,
      dependencyTargetIndex: Number.isFinite(distribution.dependencyTargetIndex)
        ? distribution.dependencyTargetIndex
        : fallback.dependencyTargetIndex,
      dependencyMap: isPlainObject(distribution.dependencyMap) ? distribution.dependencyMap : {},
      extraDependencyTargetIndex: Number.isFinite(distribution.extraDependencyTargetIndex)
        ? distribution.extraDependencyTargetIndex
        : fallback.extraDependencyTargetIndex,
      extraDependencyMap: isPlainObject(distribution.extraDependencyMap) ? distribution.extraDependencyMap : {},
      useExtraDependency: Boolean(distribution.useExtraDependency),
      useAdvanced: Boolean(distribution.useAdvanced)
    };
  }

  function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function scheduleStateSave() {
    if (isRestoringState) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCalculatorState, 300);
  }

  async function saveCalculatorState() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      await chrome.storage.local.set({
        [CALCULATOR_STATE_STORAGE_KEY]: serializeCalculatorState()
      });
    } catch (error) {
      // Calculator state persistence is a convenience; ignore write failures.
    }
  }

  function serializeCalculatorState() {
    return {
      version: CALCULATOR_STATE_VERSION,
      activeTab: state.activeTab,
      anchors: { ...state.anchors },
      solveBruttoFromRabatt: { ...state.solveBruttoFromRabatt },
      rabattLockedField: normalizePriceLockedField('r', state.rabattLockedField),
      hostingLockedField: normalizePriceLockedField('h', state.hostingLockedField),
      lastEditedRabattField: normalizePriceLockedField('r', state.lastEditedRabattField),
      lastEditedHostingField: normalizePriceLockedField('h', state.lastEditedHostingField),
      inputs: getStaticInputValues(),
      checkboxes: getStaticCheckboxValues(),
      flights: state.flights.map(flight => ({
        name: flight.name,
        pct: flight.pct,
        pricing: normalizeFlightPricing(flight.pricing),
        documentPosition: normalizeDocumentPosition(flight.documentPosition)
      })),
      hostingDocumentSource: normalizeDocumentSource(state.hostingDocumentSource),
      distribution: cloneDistributionState(state.distribution)
    };
  }

  function getStaticInputValues() {
    return Object.fromEntries(STATIC_INPUT_IDS.map(id => [id, byId(id)?.value ?? '']));
  }

  function getStaticCheckboxValues() {
    return Object.fromEntries(STATIC_CHECKBOX_IDS.map(id => [id, Boolean(byId(id)?.checked)]));
  }

  function cloneDistributionState(distribution) {
    return {
      dimensions: distribution.dimensions.map(dimension => ({
        name: dimension.name,
        positions: dimension.positions.map(position => ({
          name: position.name,
          pct: position.pct
        }))
      })),
      dependencySourceIndex: distribution.dependencySourceIndex,
      dependencyTargetIndex: distribution.dependencyTargetIndex,
      dependencyMap: cloneDependencyMap(distribution.dependencyMap),
      extraDependencyTargetIndex: distribution.extraDependencyTargetIndex,
      extraDependencyMap: cloneDependencyMap(distribution.extraDependencyMap),
      useExtraDependency: distribution.useExtraDependency,
      useAdvanced: distribution.useAdvanced
    };
  }

  function cloneDependencyMap(map) {
    return Object.fromEntries(Object.entries(map || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : []
    ]));
  }

  function bindPriceInputs(prefix, renderFn) {
    ['brutto', 'kundennetto', 'agenturnetto', 'netto'].forEach(field => {
      byId(`${prefix}-${field}`).addEventListener('input', () => {
        byId(`${prefix}-${field}`).classList.remove('computed');
        markPriceFieldEdited(prefix, field);
        getPriceState(prefix).anchor = field;
        getPriceState(prefix).solveBruttoFromRabatt = false;
        renderFn();
      });
    });
    byId(`${prefix}-rabatt`).addEventListener('input', () => {
      byId(`${prefix}-rabatt`).classList.remove('computed');
      markPriceFieldEdited(prefix, 'rabatt');
      if (canSolveBruttoFromRabatt(prefix)) {
        getPriceState(prefix).solveBruttoFromRabatt = true;
      } else {
        getPriceState(prefix).anchor = 'rabatt';
        getPriceState(prefix).solveBruttoFromRabatt = false;
      }
      renderFn();
    });

    ['bk', 'dbe'].forEach(field => {
      byId(`${prefix}-${field}`).addEventListener('input', renderFn);
      byId(`${prefix}-use-${field}`).addEventListener('change', () => {
        updateFieldStates(prefix);
        renderFn();
      });
    });
  }

  function bindPriceLockControls(prefix, renderFn) {
    const attribute = `data-${getPriceLockConfig(prefix).scope}-lock`;
    getPriceRoot(prefix).querySelectorAll(`[${attribute}]`).forEach(button => {
      button.innerHTML = calculatorIcon('lock', 'field-lock-icon');
      button.addEventListener('click', event => {
        event.preventDefault();
        togglePriceLock(prefix, button.getAttribute(attribute), renderFn);
      });
    });
  }

  function togglePriceLock(prefix, field, renderFn) {
    const config = getPriceLockConfig(prefix);
    const priceState = getPriceState(prefix);
    if (!config.fields.includes(field)) return;
    if (isPriceLockUnavailable(prefix, field)) return;

    if (priceState.lockedField === field) {
      priceState.lockedField = '';
    } else {
      if (field === 'mwst') {
        byId('r-use-mwst').checked = true;
      }
      priceState.lockedField = field;
      priceState.anchor = field;
      priceState.lastEditedField = field;
      priceState.solveBruttoFromRabatt = false;
      getPriceLockInput(prefix, field)?.classList.remove('computed');
    }

    renderFn();
  }

  function markPriceFieldEdited(prefix, field) {
    getPriceState(prefix).lastEditedField = field;
  }

  function getPriceLockConfig(prefix) {
    return PRICE_LOCK_CONFIG[prefix === 'r' ? 'r' : 'h'];
  }

  function getPriceRoot(prefix) {
    return byId(prefix === 'r' ? 'panel-rabatt' : `${prefix}-price-inputs`);
  }

  function getPriceState(prefix) {
    if (prefix !== 'r' && prefix !== 'h') {
      return state.flights[Number(prefix.slice(3))].pricing;
    }
    const config = getPriceLockConfig(prefix);
    return {
      get anchor() { return state.anchors[prefix]; },
      set anchor(value) { state.anchors[prefix] = value; },
      get solveBruttoFromRabatt() { return state.solveBruttoFromRabatt[prefix]; },
      set solveBruttoFromRabatt(value) { state.solveBruttoFromRabatt[prefix] = value; },
      get lockedField() { return state[config.stateKey]; },
      set lockedField(value) { state[config.stateKey] = value; },
      get lastEditedField() { return state[config.editedKey]; },
      set lastEditedField(value) { state[config.editedKey] = value; }
    };
  }

  function normalizeFlightPricing(pricing) {
    if (!pricing || typeof pricing !== 'object') return null;
    return {
      enabled: pricing.enabled !== false,
      inputs: Object.fromEntries(FLIGHT_PRICE_FIELDS.map(field => [field, String(pricing.inputs?.[field] ?? '')])),
      useBk: Boolean(pricing.useBk),
      useDbe: Boolean(pricing.useDbe),
      anchor: normalizePriceLockedField('h', pricing.anchor) || 'rabatt',
      solveBruttoFromRabatt: Boolean(pricing.solveBruttoFromRabatt),
      lockedField: normalizePriceLockedField('h', pricing.lockedField),
      lastEditedField: normalizePriceLockedField('h', pricing.lastEditedField)
    };
  }

  function normalizeDocumentSource(source) {
    if (!source || !/^\d{4,10}$/.test(source.campaignNumber || '') || !/^\d+$/.test(source.documentId || '')
      || !['confirmation', 'offer'].includes(source.documentType)) return null;
    return Object.fromEntries(['campaignNumber', 'documentId', 'documentType', 'snapshotId', 'capturedAt']
      .map(key => [key, String(source[key] || '')]));
  }

  function normalizeDocumentPosition(position) {
    if (!position || !Number.isSafeInteger(position.units) || position.units < 0) return null;
    return {
      key: String(position.key || ''), platform: String(position.platform || ''), creative: String(position.creative || ''),
      start: String(position.start || ''), end: String(position.end || ''), units: position.units
    };
  }

  function switchTab(tab) {
    state.activeTab = tab || 'rabatt';
    byId('calculator-title').textContent = getCalculatorTitle(state.activeTab);

    document.querySelectorAll('.tab').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === state.activeTab);
    });
    document.querySelectorAll('.panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`);
    });
    if (state.activeTab === 'verteilung') scheduleDistributionTextResize();
  }

  function getCalculatorTitle(tab) {
    if (tab === 'hosting') return 'Hosting-Rechner';
    if (tab === 'verteilung') return 'Verteilschlüssel';
    return 'Rabatt-Rechner';
  }

  function renderRabatt() {
    updateFieldStates('r');
    syncRabattVatTargetAnchor();
    const chain = resolveAndRenderChain('r', 'r-chain');
    setResolvedValues('r', chain);
    renderRabattVat(chain);
    scheduleStateSave();
  }

  function resetRabattValues() {
    const preservedRates = {
      bk: byId('r-bk').value || '0',
      dbe: byId('r-dbe').value || '0',
      mwst: byId('r-mwst').value || String(core.DEFAULT_VAT_RATE)
    };

    [
      'r-brutto',
      'r-rabatt',
      'r-kundennetto',
      'r-agenturnetto',
      'r-netto',
      'r-mwst-amount'
    ].forEach(clearInputValue);

    byId('r-bk').value = preservedRates.bk;
    byId('r-dbe').value = preservedRates.dbe;
    byId('r-mwst').value = preservedRates.mwst;
    state.rabattLockedField = '';
    state.lastEditedRabattField = '';
    state.anchors.r = 'rabatt';
    state.solveBruttoFromRabatt.r = false;
    updateFieldStates('r');
    clearRabattOutputs();
    scheduleStateSave();
  }

  function clearInputValue(id) {
    const input = byId(id);
    input.value = '';
    input.classList.remove('computed');
  }

  function clearRabattOutputs() {
    byId('r-chain').innerHTML = '';
    byId('r-mwst-summary').innerHTML = '';
    byId('r-mwst-summary').classList.remove('active');
  }

  function renderHosting() {
    updateFieldStates('h');
    const chain = resolveAndRenderChain('h', 'h-chain');
    setResolvedValues('h', chain);

    const flights = state.flights.map((flight, index) => {
      let flightChain = chain;
      if (flight.pricing?.enabled) {
        const prefix = `hf-${index}`;
        updateFieldStates(prefix);
        flightChain = resolveAndRenderChain(prefix, `${prefix}-chain`);
        setResolvedValues(prefix, flightChain);
        syncFlightPricingInputs(index);
      }
      return { name: flight.name, pct: flight.pct, netto: flightChain.netto };
    });
    const hosting = core.calculateHosting({
      budget: getValue('h-budget'),
      hostTkp: getValue('h-host-tkp'),
      production: getValue('h-prod'),
      netto: chain.netto,
      flights
    });
    renderFlightSum();
    hosting.flights.forEach((flight, index) => {
      byId(`hf-${index}-impressions`).textContent = `${core.formatImpressions(flight.impressions)} Imp.`;
      byId(`hf-${index}-netto-hint`).textContent = `Netto TKP ${core.formatCurrency(flight.netto)}`;
    });
    renderHostingMetrics(hosting);
    renderHostingRows(hosting);
    scheduleStateSave();
  }

  function resolveAndRenderChain(prefix, targetId) {
    const priceState = getPriceState(prefix);
    const priceInput = {
      anchor: priceState.anchor,
      brutto: getValue(`${prefix}-brutto`),
      rabatt: getValue(`${prefix}-rabatt`),
      kundennetto: getValue(`${prefix}-kundennetto`),
      agenturnetto: getValue(`${prefix}-agenturnetto`),
      netto: getValue(`${prefix}-netto`),
      useBk: byId(`${prefix}-use-bk`).checked,
      bk: getValue(`${prefix}-bk`),
      useDbe: byId(`${prefix}-use-dbe`).checked,
      dbe: getValue(`${prefix}-dbe`),
      useVat: prefix === 'r' ? byId('r-use-mwst').checked : false,
      vatRate: prefix === 'r' ? getValue('r-mwst') : core.DEFAULT_VAT_RATE,
      solveBruttoFromRabatt: Boolean(priceState.solveBruttoFromRabatt)
    };

    if (prefix === 'r' && state.anchors.r === 'mwst') {
      const targetField = getRabattVatTargetField();
      priceInput.anchor = targetField;
      priceInput[targetField] = getValue('r-mwst-amount');
      priceInput.useVat = true;
      priceInput.solveBruttoFromRabatt = Boolean(state.solveBruttoFromRabatt.r);
    }
    applyPriceLockToPriceInput(prefix, priceInput);

    const result = core.resolvePriceChain(priceInput);

    renderChain(targetId, result, {
      brutto: result.brutto ?? core.parseNumber(getValue(`${prefix}-brutto`)),
      useBk: byId(`${prefix}-use-bk`).checked,
      bk: core.parseNumber(getValue(`${prefix}-bk`)),
      useDbe: byId(`${prefix}-use-dbe`).checked,
      dbe: core.parseNumber(getValue(`${prefix}-dbe`))
    });

    return result;
  }

  function applyPriceLockToPriceInput(prefix, priceInput) {
    const priceState = getPriceState(prefix);
    const lockedField = normalizePriceLockedField(prefix, priceState.lockedField);
    if (!lockedField) return;

    const activeField = normalizePriceLockedField(prefix, priceState.lastEditedField) || priceState.anchor;

    if (lockedField === 'mwst') {
      applyRabattVatTargetInput(priceInput, activeField === 'rabatt');
      return;
    }

    if (activeField === 'mwst') {
      if (lockedField === 'brutto') {
        applyRabattVatTargetInput(priceInput, false);
        return;
      }
      if (lockedField === 'rabatt') {
        applyRabattVatTargetInput(priceInput, true);
        return;
      }

      priceInput.anchor = lockedField;
      priceInput.solveBruttoFromRabatt = false;
      return;
    }

    if (lockedField === 'brutto') {
      priceInput.anchor = ['kundennetto', 'agenturnetto', 'netto'].includes(activeField)
        ? activeField
        : 'rabatt';
      priceInput.solveBruttoFromRabatt = false;
      return;
    }

    if (lockedField === 'rabatt') {
      priceInput.anchor = ['kundennetto', 'agenturnetto', 'netto'].includes(activeField)
        ? activeField
        : 'rabatt';
      priceInput.solveBruttoFromRabatt = ['kundennetto', 'agenturnetto', 'netto'].includes(activeField);
      return;
    }

    priceInput.anchor = lockedField;
    priceInput.solveBruttoFromRabatt = activeField === 'rabatt';
  }

  function applyRabattVatTargetInput(priceInput, solveBruttoFromRabatt) {
    const targetField = getRabattVatTargetField();
    priceInput.anchor = targetField;
    priceInput[targetField] = getValue('r-mwst-amount');
    priceInput.useVat = true;
    priceInput.solveBruttoFromRabatt = Boolean(solveBruttoFromRabatt);
  }

  function syncRabattVatTargetAnchor() {
    const input = byId('r-mwst-amount');
    const hasManualVatTarget = byId('r-use-mwst').checked
      && input.value.trim()
      && !input.classList.contains('computed');

    if (hasManualVatTarget && shouldUseRabattVatTargetAsAnchor()) {
      state.anchors.r = 'mwst';
      if (!state.solveBruttoFromRabatt.r && shouldSolveBruttoFromRabattForVatTarget()) {
        state.solveBruttoFromRabatt.r = true;
      }
    } else if (state.anchors.r === 'mwst' && !input.value.trim()) {
      state.anchors.r = 'rabatt';
      state.solveBruttoFromRabatt.r = false;
    }
  }

  function shouldUseRabattVatTargetAsAnchor() {
    if (state.anchors.r === 'mwst') return true;
    return state.anchors.r === 'brutto' && hasManualPositivePrice('r-brutto');
  }

  function shouldSolveBruttoFromRabattForVatTarget() {
    return !hasManualPositivePrice('r-brutto');
  }

  function hasManualPositivePrice(id) {
    const input = byId(id);
    return Boolean(input.value.trim())
      && !input.classList.contains('computed')
      && core.parseNumber(input.value) > 0;
  }

  function canSolveBruttoFromRabatt(prefix) {
    if (getPriceLockedField(prefix) === 'brutto') return false;
    const anchor = getPriceState(prefix).anchor;
    if (anchor === 'mwst') return Boolean(getValue('r-mwst-amount').trim());
    if (!['kundennetto', 'agenturnetto', 'netto'].includes(anchor)) return false;

    return Boolean(getValue(`${prefix}-${anchor}`).trim());
  }

  function renderRabattVat(result) {
    const summary = byId('r-mwst-summary');
    const amountInput = byId('r-mwst-amount');
    const vat = result.vat;

    summary.classList.toggle('active', Boolean(vat));
    if (!vat) {
      summary.innerHTML = '';
      if (state.anchors.r !== 'mwst') {
        amountInput.value = '';
        amountInput.classList.remove('computed');
      }
      return;
    }

    const baseLabel = vat.baseLabel || 'Netto';
    const exVat = core.formatCurrency(vat.baseAmount ?? result.netto);
    const vatAmount = core.formatCurrency(vat.amount);
    const inclVat = core.formatCurrency(vat.total);
    const rate = core.formatNumber(vat.rate, 2);

    summary.innerHTML = [
      chainCard(`${baseLabel} exkl. MwSt.`, exVat),
      chainCard(`MwSt. ${rate}%`, vatAmount),
      chainCard(`${baseLabel} inkl. MwSt.`, inclVat)
    ].join('');

    if (state.anchors.r === 'mwst' || state.rabattLockedField === 'mwst') {
      amountInput.classList.remove('computed');
    } else if (document.activeElement !== amountInput) {
      amountInput.value = inclVat;
      amountInput.classList.add('computed');
    }
  }

  function getRabattVatTargetField() {
    if (byId('r-use-dbe').checked) return 'netto';
    if (byId('r-use-bk').checked) return 'agenturnetto';
    return 'kundennetto';
  }

  function setResolvedValues(prefix, result) {
    const priceState = getPriceState(prefix);
    const values = {
      rabatt: core.formatNumber(result.rabatt, 6),
      kundennetto: core.formatNumber(result.kundennetto, 2),
      agenturnetto: core.formatNumber(result.agenturnetto, 2),
      netto: core.formatNumber(result.netto, 2)
    };
    if (result.bruttoComputed) {
      values.brutto = core.formatNumber(result.brutto, 2);
    }

    Object.entries(values).forEach(([field, value]) => {
      const input = byId(`${prefix}-${field}`);
      if (input.readOnly) return;
      if (getPriceLockedField(prefix) === field) {
        input.classList.remove('computed');
        return;
      }
      if (priceState.anchor === field || (field === 'rabatt' && priceState.solveBruttoFromRabatt)) {
        input.classList.remove('computed');
        return;
      }

      input.value = value;
      input.classList.add('computed');
    });
  }

  function updateFieldStates(prefix) {
    normalizePriceLockForCurrentOptions(prefix);
    const useBk = byId(`${prefix}-use-bk`).checked;
    const useDbe = byId(`${prefix}-use-dbe`).checked;

    setOptionalField(prefix, 'agenturnetto', useBk);
    setOptionalField(prefix, 'netto', useDbe);
    if (prefix === 'r') {
      setRabattVatFieldState(byId('r-use-mwst').checked);
    }
    renderPriceLocks(prefix);
  }

  function setOptionalField(prefix, field, enabled) {
    const input = byId(`${prefix}-${field}`);
    const wrapper = byId(`${prefix}-field-${field}`);
    const locked = getPriceLockedField(prefix) === field;
    wrapper.classList.toggle('disabled', !enabled);
    input.readOnly = !enabled || locked;
    input.classList.toggle('disabled', !enabled);
    if (!enabled) {
      input.value = '';
      if (getPriceState(prefix).anchor === field) {
        getPriceState(prefix).anchor = 'rabatt';
        getPriceState(prefix).solveBruttoFromRabatt = false;
      }
    }
  }

  function setRabattVatFieldState(enabled) {
    const input = byId('r-mwst-amount');
    const wrapper = byId('r-field-mwst-amount');
    const locked = state.rabattLockedField === 'mwst';

    wrapper.classList.toggle('disabled', !enabled);
    input.readOnly = !enabled || locked;
    input.classList.toggle('disabled', !enabled);
    if (enabled) return;

    input.value = '';
    input.classList.remove('computed', 'locked');
    if (state.rabattLockedField === 'mwst') {
      state.rabattLockedField = '';
    }
    if (state.anchors.r === 'mwst') {
      state.anchors.r = 'rabatt';
      state.solveBruttoFromRabatt.r = false;
    }
    if (state.lastEditedRabattField === 'mwst') {
      state.lastEditedRabattField = '';
    }
  }

  function normalizePriceLockedField(prefix, field) {
    return getPriceLockConfig(prefix).fields.includes(field) ? field : '';
  }

  function getPriceLockedField(prefix) {
    return normalizePriceLockedField(prefix, getPriceState(prefix).lockedField);
  }

  function normalizePriceLockForCurrentOptions(prefix) {
    const priceState = getPriceState(prefix);
    const lockedField = getPriceLockedField(prefix);
    if (!lockedField || !isPriceLockUnavailable(prefix, lockedField)) {
      priceState.lockedField = lockedField;
      return;
    }

    priceState.lockedField = '';
    if (priceState.anchor === lockedField) {
      priceState.anchor = 'rabatt';
      priceState.solveBruttoFromRabatt = false;
    }
    if (priceState.lastEditedField === lockedField) {
      priceState.lastEditedField = '';
    }
  }

  function isPriceLockUnavailable(prefix, field) {
    if (field === 'agenturnetto') return !byId(`${prefix}-use-bk`).checked;
    if (field === 'netto') return !byId(`${prefix}-use-dbe`).checked;
    if (field === 'mwst') return !byId('r-use-mwst').checked;
    return false;
  }

  function renderPriceLocks(prefix) {
    const config = getPriceLockConfig(prefix);
    const lockedField = getPriceLockedField(prefix);

    config.fields.forEach(field => {
      const active = lockedField === field;
      const unavailable = isPriceLockUnavailable(prefix, field);
      const label = `${PRICE_LOCK_LABELS[field]}${prefix !== 'r' && field !== 'rabatt' ? ' TKP' : ''}`;
      const input = getPriceLockInput(prefix, field);
      const wrapper = getPriceRoot(prefix).querySelector(`[data-${config.scope}-field="${field}"]`);
      const button = getPriceRoot(prefix).querySelector(`[data-${config.scope}-lock="${field}"]`);

      wrapper?.classList.toggle('locked', active);
      input?.classList.toggle('locked', active);
      if (input && !['agenturnetto', 'netto', 'mwst'].includes(field)) {
        input.readOnly = active;
      }
      if (active) {
        input?.classList.remove('computed');
      }

      if (!button) return;
      button.disabled = unavailable;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      button.title = active ? `${label} freigeben` : `${label} fixieren`;
      button.setAttribute('aria-label', button.title);
    });
  }

  function getPriceLockInput(prefix, field) {
    return byId(field === 'mwst' ? 'r-mwst-amount' : `${prefix}-${field}`);
  }

  function renderChain(targetId, result, options) {
    const cards = [
      chainCard('Brutto TKP', core.formatCurrency(options.brutto)),
      chainCard('Rabatt', `${core.formatNumber(result.rabatt, 6)}%`, true),
      chainCard('Kundennetto', core.formatCurrency(result.kundennetto))
    ];

    if (options.useBk) {
      cards.push(chainCard(`Agenturnetto\n(-BK ${core.formatNumber(options.bk, 2)}%)`, core.formatCurrency(result.agenturnetto)));
    }
    if (options.useDbe) {
      cards.push(chainCard(`Netto\n(-DBE ${core.formatNumber(options.dbe, 2)}%)`, core.formatCurrency(result.netto)));
    }

    byId(targetId).innerHTML = cards.join('');
  }

  function chainCard(label, value, highlight = false) {
    return `<div class="chain-card${highlight ? ' highlight' : ''}">
      ${copyButton(value)}
      <div class="chain-label">${escapeHtml(label).replace(/\n/g, '<br>')}</div>
      <div class="chain-value">${escapeHtml(value)}</div>
    </div>`;
  }

  function renderHostingMetrics(hosting) {
    byId('h-metrics').innerHTML = [
      metric('Budget für Impressions', core.formatCurrency(hosting.budgetForImpressions), 'nach Abzug Produktion'),
      metric('Effektiver TKP', core.formatCurrency(hosting.effectiveTkp), `WM-Misch-TKP ${core.formatCurrency(hosting.mediaTkp)} + Host ${core.formatCurrency(getValue('h-host-tkp'))}`),
      metric('Gesamte Impressions', core.formatImpressions(hosting.totalImpressions)),
      metric('WM Betrag netto', core.formatCurrency(hosting.mediaAmount)),
      metric('Hosting Betrag', core.formatCurrency(hosting.hostingAmount)),
      metric('Produktion', core.formatCurrency(hosting.production)),
      metric('Total netto', core.formatCurrency(hosting.total))
    ].join('');
  }

  function metric(label, value, sub = '') {
    return `<div class="metric">
      ${copyButton(value)}
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-sub">${escapeHtml(sub)}</div>
    </div>`;
  }

  function copyButton(value, extraClass = '') {
    const className = `copy-value${extraClass ? ` ${extraClass}` : ''}`;
    return `<button class="${className}" type="button" data-copy-value="${escapeAttribute(value)}" title="Wert kopieren">${calculatorIcon('copy')}</button>`;
  }

  function calculatorIcon(name, className = 'calc-icon') {
    return globalThis.goPilotIcons?.render(name, { className }) || '';
  }

  async function handleCopyButtonClick(event) {
    const button = event.target.closest?.('.copy-value');
    if (!button) return;

    event.preventDefault();
    const value = sanitizeCopyValue(button.dataset.copyValue || '');

    try {
      await copyText(value);
      markCopied(button);
    } catch (error) {
      markCopyFailed(button);
    }
  }

  function sanitizeCopyValue(value) {
    return String(value ?? '').replace(/'/g, '');
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function markCopied(button) {
    const previousHtml = button.dataset.defaultHtml || calculatorIcon('copy');
    button.dataset.defaultHtml = previousHtml;
    button.innerHTML = calculatorIcon('check');
    button.classList.add('copied');
    setTimeout(() => {
      button.innerHTML = previousHtml;
      button.classList.remove('copied');
    }, 800);
  }

  function markCopyFailed(button) {
    const previousHtml = button.dataset.defaultHtml || calculatorIcon('copy');
    button.dataset.defaultHtml = previousHtml;
    button.innerHTML = calculatorIcon('error');
    button.classList.add('copied');
    setTimeout(() => {
      button.innerHTML = previousHtml;
      button.classList.remove('copied');
    }, 900);
  }

  function renderHostingRows(hosting) {
    const rows = hosting.flights.map(flight => {
      const impressions = core.formatImpressions(flight.impressions);
      const amount = core.formatCurrency(flight.amount);

      return `<tr>
        <td><span class="badge media">Werbemittel</span></td>
        <td>${escapeHtml(flight.name)}</td>
        <td class="num">${impressions} ${copyButton(impressions, 'copy-value-inline')}</td>
        <td class="num">${core.formatCurrency(flight.netto)}</td>
        <td class="num">${amount} ${copyButton(amount, 'copy-value-inline')}</td>
      </tr>`;
    });

    const totalImpressions = core.formatImpressions(hosting.totalImpressions);
    const hostingAmount = core.formatCurrency(hosting.hostingAmount);
    rows.push(`<tr>
      <td><span class="badge hosting">Hosting</span></td>
      <td>-</td>
      <td class="num">${totalImpressions} ${copyButton(totalImpressions, 'copy-value-inline')}</td>
      <td class="num">${core.formatCurrency(getValue('h-host-tkp'))}</td>
      <td class="num">${hostingAmount} ${copyButton(hostingAmount, 'copy-value-inline')}</td>
    </tr>`);
    const production = core.formatCurrency(hosting.production);
    rows.push(`<tr>
      <td><span class="badge production">Produktion</span></td>
      <td>-</td>
      <td class="num">-</td>
      <td class="num">Fixpreis</td>
      <td class="num">${production} ${copyButton(production, 'copy-value-inline')}</td>
    </tr>`);
    const total = core.formatCurrency(hosting.total);
    rows.push(`<tr class="total-row">
      <td colspan="4">Total</td>
      <td class="num">${total} ${copyButton(total, 'copy-value-inline')}</td>
    </tr>`);

    byId('h-tbody').innerHTML = rows.join('');
  }

  function bindDistributionControls() {
    byId('v-total').addEventListener('input', renderDistributionResult);
    scheduleDistributionTextResize();
    byId('v-text').addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        parseDistributionText();
      }
    });
    byId('v-text').addEventListener('input', () => {
      autoResizeDistributionText();
    });
    byId('v-parse').addEventListener('click', parseDistributionText);
    byId('v-reset').addEventListener('click', resetDistribution);
    byId('v-use-advanced').addEventListener('change', () => {
      state.distribution.useAdvanced = byId('v-use-advanced').checked;
      renderDistribution();
    });
    byId('v-dependency-source').addEventListener('change', () => {
      state.distribution.dependencySourceIndex = Number(byId('v-dependency-source').value) || 0;
      state.distribution.dependencyMap = {};
      ensureValidDependencyIndexes();
      ensureDependencyMap();
      renderDistribution();
    });
    byId('v-dependency-target').addEventListener('change', () => {
      state.distribution.dependencyTargetIndex = Number(byId('v-dependency-target').value) || 0;
      state.distribution.dependencyMap = {};
      ensureValidDependencyIndexes();
      ensureDependencyMap();
      renderDistribution();
    });
    byId('v-use-extra-dependency').addEventListener('change', () => {
      state.distribution.useExtraDependency = byId('v-use-extra-dependency').checked;
      renderDistribution();
    });
    byId('v-extra-dependency-target').addEventListener('change', () => {
      state.distribution.extraDependencyTargetIndex = Number(byId('v-extra-dependency-target').value) || 0;
      state.distribution.extraDependencyMap = {};
      ensureValidDependencyIndexes();
      ensureDependencyMap();
      renderDistribution();
    });
    byId('v-add-dim').addEventListener('click', addDistributionDimension);
  }

  function resetDistribution() {
    state.distribution = createDefaultDistributionState();
    byId('v-text').value = '';
    scheduleDistributionTextResize();
    byId('v-parse-status').textContent = 'Zurückgesetzt.';
    renderDistribution();
  }

  function renderDistribution() {
    ensureValidDependencyIndexes();
    ensureDependencyMap();
    byId('v-use-advanced').checked = state.distribution.useAdvanced;
    byId('v-advanced-section').classList.toggle('active', state.distribution.useAdvanced);
    byId('v-use-extra-dependency').checked = state.distribution.useExtraDependency;
    renderDistributionDependencyOptions();
    renderDependencyMatrix();
    renderExtraDependencyMatrix();
    renderDistributionDimensions();
    renderDistributionResult();
    scheduleDistributionTextResize();
    scheduleStateSave();
  }

  function renderDistributionDependencyOptions() {
    renderDimensionSelect('v-dependency-source', state.distribution.dependencySourceIndex);
    renderDimensionSelect('v-dependency-target', state.distribution.dependencyTargetIndex);
    renderDimensionSelect('v-extra-dependency-target', state.distribution.extraDependencyTargetIndex);
  }

  function renderDimensionSelect(id, selectedIndex) {
    byId(id).innerHTML = state.distribution.dimensions.map((dimension, index) => (
      `<option value="${index}"${index === selectedIndex ? ' selected' : ''}>${escapeHtml(dimension.name || `Dimension ${index + 1}`)}</option>`
    )).join('');
  }

  function renderDependencyMatrix() {
    renderDependencyMatrixFor({
      containerId: 'v-dependency-matrix',
      targetIndex: state.distribution.dependencyTargetIndex,
      map: state.distribution.dependencyMap,
      inputClass: 'v-dependency-check',
      updateMap: updateDependencyMapFromMatrix,
      emptyWhenInactive: false
    });
  }

  function renderExtraDependencyMatrix() {
    renderDependencyMatrixFor({
      containerId: 'v-extra-dependency-matrix',
      targetIndex: state.distribution.extraDependencyTargetIndex,
      map: state.distribution.extraDependencyMap,
      inputClass: 'v-extra-dependency-check',
      updateMap: updateExtraDependencyMapFromMatrix,
      emptyWhenInactive: !state.distribution.useExtraDependency
    });
  }

  function renderDependencyMatrixFor(options) {
    const container = byId(options.containerId);
    if (!state.distribution.useAdvanced) {
      container.innerHTML = '';
      return;
    }
    if (options.emptyWhenInactive) {
      container.innerHTML = '';
      return;
    }

    const sourceIndex = state.distribution.dependencySourceIndex;
    const targetIndex = options.targetIndex;
    const sourceDimension = state.distribution.dimensions[sourceIndex];
    const targetDimension = state.distribution.dimensions[targetIndex];
    if (!sourceDimension || !targetDimension) {
      container.innerHTML = '';
      return;
    }

    if (sourceIndex === targetIndex) {
      container.innerHTML = '<div class="field-hint dependency-warning">Positionen aus und abhängig von müssen zwei unterschiedliche Dimensionen sein.</div>';
      return;
    }

    const targetHeaders = targetDimension.positions.map(position => (
      `<span>${escapeHtml(position.name || '-')}</span>`
    )).join('');
    const rows = sourceDimension.positions.map((sourcePosition, sourcePositionIndex) => {
      const selectedTargets = new Set(options.map[String(sourcePositionIndex)] || []);
      const checks = targetDimension.positions.map((targetPosition, targetPositionIndex) => `
        <label class="dependency-check">
          <input class="${options.inputClass}" type="checkbox" data-source-pos="${sourcePositionIndex}" data-target-pos="${targetPositionIndex}"${selectedTargets.has(targetPositionIndex) ? ' checked' : ''}>
          <span>${escapeHtml(targetPosition.name || '-')}</span>
        </label>
      `).join('');

      return `<div class="dependency-row">
        <div class="dependency-source">${escapeHtml(sourcePosition.name || `Position ${sourcePositionIndex + 1}`)}</div>
        <div class="dependency-targets">${checks}</div>
      </div>`;
    }).join('');

    container.innerHTML = `<div class="dependency-matrix">
      <div class="dependency-head">
        <span></span>
        <div class="dependency-target-head">${targetHeaders}</div>
      </div>
      ${rows}
    </div>`;

    container.querySelectorAll(`.${options.inputClass}`).forEach(input => {
      input.addEventListener('change', () => {
        options.updateMap();
        renderDistributionResult();
      });
    });
  }

  function updateDependencyMapFromMatrix() {
    const map = {};
    byId('v-dependency-matrix').querySelectorAll('.v-dependency-check').forEach(input => {
      const sourcePositionIndex = input.dataset.sourcePos;
      if (!map[sourcePositionIndex]) map[sourcePositionIndex] = [];
      if (input.checked) map[sourcePositionIndex].push(Number(input.dataset.targetPos));
    });
    state.distribution.dependencyMap = map;
  }

  function updateExtraDependencyMapFromMatrix() {
    const map = {};
    byId('v-extra-dependency-matrix').querySelectorAll('.v-extra-dependency-check').forEach(input => {
      const sourcePositionIndex = input.dataset.sourcePos;
      if (!map[sourcePositionIndex]) map[sourcePositionIndex] = [];
      if (input.checked) map[sourcePositionIndex].push(Number(input.dataset.targetPos));
    });
    state.distribution.extraDependencyMap = map;
  }

  function renderDistributionDimensions() {
    byId('v-dim-container').innerHTML = state.distribution.dimensions.map((dimension, dimensionIndex) => {
      const positions = dimension.positions.map((position, positionIndex) => `
        <div class="distribution-row">
          <label class="field">
            <input class="v-pos-name" data-dim="${dimensionIndex}" data-pos="${positionIndex}" type="text" value="${escapeAttribute(position.name)}">
          </label>
          <label class="small-field distribution-pct">
            Anteil %<input class="v-pos-pct" data-dim="${dimensionIndex}" data-pos="${positionIndex}" type="text" inputmode="decimal" value="${escapeAttribute(position.pct)}">
          </label>
          ${dimension.positions.length > 1 ? `<button class="remove-flight v-remove-pos" type="button" data-dim="${dimensionIndex}" data-pos="${positionIndex}" title="Position entfernen">${calculatorIcon('close')}</button>` : '<div></div>'}
        </div>
      `).join('');

      return `<div class="distribution-dim">
        <div class="distribution-dim-header">
          <label class="field distribution-dim-title">
            <input class="v-dim-name" data-dim="${dimensionIndex}" type="text" value="${escapeAttribute(dimension.name)}">
          </label>
          ${state.distribution.dimensions.length > 1 ? `<button class="remove-flight v-remove-dim" type="button" data-dim="${dimensionIndex}" title="Dimension entfernen">${calculatorIcon('close')}</button>` : ''}
        </div>
        ${positions}
        <div class="distribution-sum" id="v-dim-sum-${dimensionIndex}">${distributionSumMarkup(core.getDistributionDimensionSum(dimension), `v-normalize-dim-${dimensionIndex}`)}</div>
        <button class="text-button v-add-pos" type="button" data-dim="${dimensionIndex}">+ Position</button>
      </div>`;
    }).join('');

    byId('v-dim-container').querySelectorAll('.v-dim-name').forEach(input => {
      input.addEventListener('input', () => {
        state.distribution.dimensions[Number(input.dataset.dim)].name = input.value;
        renderDistributionDependencyOptions();
        renderDistributionResult();
      });
    });
    byId('v-dim-container').querySelectorAll('.v-pos-name').forEach(input => {
      input.addEventListener('input', () => {
        getDistributionPosition(input).name = input.value;
        renderDependencyMatrix();
        renderDistributionResult();
      });
    });
    byId('v-dim-container').querySelectorAll('.v-pos-pct').forEach(input => {
      input.addEventListener('input', () => {
        getDistributionPosition(input).pct = core.parseNumber(input.value);
        renderDistributionDimSum(Number(input.dataset.dim));
        renderDistributionResult();
      });
    });
    byId('v-dim-container').querySelectorAll('.v-remove-dim').forEach(button => {
      button.addEventListener('click', () => removeDistributionDimension(Number(button.dataset.dim)));
    });
    byId('v-dim-container').querySelectorAll('.v-remove-pos').forEach(button => {
      button.addEventListener('click', () => removeDistributionPosition(Number(button.dataset.dim), Number(button.dataset.pos)));
    });
    byId('v-dim-container').querySelectorAll('.v-add-pos').forEach(button => {
      button.addEventListener('click', () => addDistributionPosition(Number(button.dataset.dim)));
    });
    state.distribution.dimensions.forEach((dimension, index) => {
      renderDistributionDimSum(index);
    });
  }

  function renderDistributionDimSum(dimensionIndex) {
    const buttonId = `v-normalize-dim-${dimensionIndex}`;
    byId(`v-dim-sum-${dimensionIndex}`).innerHTML = distributionSumMarkup(
      core.getDistributionDimensionSum(state.distribution.dimensions[dimensionIndex]),
      buttonId
    );
    byId(buttonId)?.addEventListener('click', () => normalizeDistributionDimension(dimensionIndex));
  }

  function distributionSumMarkup(sum, normalizeButtonId) {
    const ok = Math.abs(sum - 100) < 0.01;
    return `<span class="sum-line"><span class="sum ${ok ? 'ok' : 'error'}">Summe: ${core.formatNumber(sum, 2)}%</span>${ok ? '' : `<button class="text-button distribution-normalize" type="button" id="${normalizeButtonId}">Auf 100% normalisieren</button>`}</span>`;
  }

  function renderDistributionResult() {
    const total = core.parseNumber(getValue('v-total'));
    const combinations = core.getDisplayDistributionCombinations(
      core.getDistributionCombinations(state.distribution),
      state.distribution
    );
    const result = byId('v-result');
    if (!combinations.length) {
      result.innerHTML = '';
      return;
    }

    const visibleDimensions = core.getVisibleDistributionDimensions(state.distribution);
    const headers = visibleDimensions.map(dimension => `<th>${escapeHtml(dimension.name)}</th>`).join('');
    const rows = combinations.map(combination => {
      const value = total * combination.pct / 100;
      const formattedValue = core.formatImpressions(value);
      const labels = combination.labels.map(label => (
        `<td><span class="result-label">${escapeHtml(label.position)}</span></td>`
      )).join('');

      return `<tr>
        ${labels}
        <td class="num">${core.formatNumber(combination.pct, 4)} ${copyButton(core.formatNumber(combination.pct, 4), 'copy-value-inline')}</td>
        <td class="num">${formattedValue} ${copyButton(formattedValue, 'copy-value-inline')}</td>
      </tr>`;
    }).join('');
    const totalPct = combinations.reduce((sum, combination) => sum + combination.pct, 0);

    result.innerHTML = `<table>
      <thead><tr>${headers}<th class="num">Anteil %</th><th class="num">Wert</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          ${visibleDimensions.map(() => '<td></td>').join('')}
          <td class="num">${core.formatNumber(totalPct, 2)}%</td>
          <td class="num">${core.formatImpressions(total)}</td>
        </tr>
      </tbody>
    </table>`;
  }

  function parseDistributionText() {
    const raw = getValue('v-text').trim();
    if (!raw) return;

    const dimensions = core.parseDistributionText(raw);

    if (!dimensions.length) {
      byId('v-parse-status').textContent = 'Nichts erkannt. Format: DE 65% FR 35% / Instream 55% Halfpage 45%';
      return;
    }

    state.distribution.dimensions = dimensions;
    state.distribution.dependencySourceIndex = getDefaultDependencySourceIndex();
    state.distribution.dependencyTargetIndex = getDefaultDependencyTargetIndex();
    state.distribution.extraDependencyTargetIndex = getDefaultExtraDependencyTargetIndex();
    state.distribution.dependencyMap = {};
    state.distribution.extraDependencyMap = {};
    state.distribution.useExtraDependency = false;
    ensureValidDependencyIndexes();
    ensureDependencyMap();
    byId('v-parse-status').textContent = dimensions.map(dimension => `${dimension.name}: ${dimension.positions.length} Positionen`).join(' · ');
    renderDistribution();
  }

  function autoResizeDistributionText() {
    const input = byId('v-text');
    const maxHeight = 180;
    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight + 2, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function scheduleDistributionTextResize() {
    requestAnimationFrame(() => {
      autoResizeDistributionText();
      requestAnimationFrame(autoResizeDistributionText);
    });
  }

  function addDistributionDimension() {
    state.distribution.dimensions.push({ name: `Dimension ${state.distribution.dimensions.length + 1}`, positions: [{ name: 'A', pct: 50 }, { name: 'B', pct: 50 }] });
    resetDependencyMap();
    renderDistribution();
  }

  function removeDistributionDimension(index) {
    state.distribution.dimensions.splice(index, 1);
    if (state.distribution.dependencySourceIndex >= index) {
      state.distribution.dependencySourceIndex = Math.max(0, state.distribution.dependencySourceIndex - 1);
    }
    if (state.distribution.dependencyTargetIndex >= index) {
      state.distribution.dependencyTargetIndex = Math.max(0, state.distribution.dependencyTargetIndex - 1);
    }
    resetDependencyMap();
    renderDistribution();
  }

  function addDistributionPosition(dimensionIndex) {
    const positions = state.distribution.dimensions[dimensionIndex].positions;
    positions.push({ name: `Position ${positions.length + 1}`, pct: 0 });
    resetDependencyMap();
    renderDistribution();
  }

  function removeDistributionPosition(dimensionIndex, positionIndex) {
    state.distribution.dimensions[dimensionIndex].positions.splice(positionIndex, 1);
    resetDependencyMap();
    renderDistribution();
  }

  function normalizeDistributionDimension(dimensionIndex) {
    core.normalizeDistributionItems(state.distribution.dimensions[dimensionIndex].positions);
    renderDistribution();
  }

  function resetDependencyMap() {
    state.distribution.dependencyMap = {};
    state.distribution.extraDependencyMap = {};
    ensureValidDependencyIndexes();
    ensureDependencyMap();
  }

  function ensureValidDependencyIndexes() {
    const maxIndex = Math.max(0, state.distribution.dimensions.length - 1);

    if (!Number.isFinite(state.distribution.dependencySourceIndex)
      || state.distribution.dependencySourceIndex < 0
      || state.distribution.dependencySourceIndex > maxIndex) {
      state.distribution.dependencySourceIndex = getDefaultDependencySourceIndex();
    }

    if (!Number.isFinite(state.distribution.dependencyTargetIndex)
      || state.distribution.dependencyTargetIndex < 0
      || state.distribution.dependencyTargetIndex > maxIndex) {
      state.distribution.dependencyTargetIndex = getDefaultDependencyTargetIndex();
    }

    if (!Number.isFinite(state.distribution.extraDependencyTargetIndex)
      || state.distribution.extraDependencyTargetIndex < 0
      || state.distribution.extraDependencyTargetIndex > maxIndex) {
      state.distribution.extraDependencyTargetIndex = getDefaultExtraDependencyTargetIndex();
    }

    if (state.distribution.dimensions.length > 1
      && state.distribution.dependencySourceIndex === state.distribution.dependencyTargetIndex) {
      state.distribution.dependencyTargetIndex = state.distribution.dependencySourceIndex === 0 ? 1 : 0;
    }

    if (state.distribution.dimensions.length > 1
      && state.distribution.extraDependencyTargetIndex === state.distribution.dependencySourceIndex) {
      state.distribution.extraDependencyTargetIndex = getDefaultExtraDependencyTargetIndex();
    }
  }

  function getDefaultDependencySourceIndex() {
    return core.getDefaultDistributionDependencyIndexes(state.distribution.dimensions).dependencySourceIndex;
  }

  function getDefaultDependencyTargetIndex() {
    return core.getDefaultDistributionDependencyIndexes(state.distribution.dimensions).dependencyTargetIndex;
  }

  function getDefaultExtraDependencyTargetIndex() {
    const indexes = core.getDefaultDistributionDependencyIndexes(state.distribution.dimensions);
    if (indexes.extraDependencyTargetIndex !== state.distribution.dependencySourceIndex) {
      return indexes.extraDependencyTargetIndex;
    }

    return state.distribution.dependencySourceIndex === 0 ? 1 : 0;
  }

  function ensureDependencyMap() {
    state.distribution.dependencyMap = core.buildDistributionDependencyMap({
      dimensions: state.distribution.dimensions,
      sourceIndex: state.distribution.dependencySourceIndex,
      targetIndex: state.distribution.dependencyTargetIndex,
      currentMap: state.distribution.dependencyMap
    });
    state.distribution.extraDependencyMap = core.buildDistributionDependencyMap({
      dimensions: state.distribution.dimensions,
      sourceIndex: state.distribution.dependencySourceIndex,
      targetIndex: state.distribution.extraDependencyTargetIndex,
      currentMap: state.distribution.extraDependencyMap
    });
  }

  function getDistributionPosition(input) {
    return state.distribution.dimensions[Number(input.dataset.dim)].positions[Number(input.dataset.pos)];
  }

  function renderFlights() {
    byId('flight-container').innerHTML = state.flights.map((flight, index) => createFlightMarkup(flight, index)).join('');
    byId('flight-container').querySelectorAll('.flight-name').forEach(input => {
      input.addEventListener('input', () => {
        state.flights[Number(input.dataset.index)].name = input.value;
        renderHosting();
      });
    });
    byId('flight-container').querySelectorAll('.flight-pct').forEach(input => {
      input.addEventListener('input', () => {
        state.flights[Number(input.dataset.index)].pct = core.parseNumber(input.value);
        renderHosting();
      });
    });
    byId('flight-container').querySelectorAll('.flight-own-prices').forEach(input => {
      input.addEventListener('change', () => {
        const flight = state.flights[Number(input.dataset.index)];
        if (!flight.pricing) {
          flight.pricing = normalizeFlightPricing({
            inputs: Object.fromEntries(FLIGHT_PRICE_FIELDS.map(field => [field, getValue(`h-${field}`)])),
            useBk: byId('h-use-bk').checked,
            useDbe: byId('h-use-dbe').checked,
            anchor: state.anchors.h,
            solveBruttoFromRabatt: state.solveBruttoFromRabatt.h
          });
        }
        flight.pricing.enabled = input.checked;
        renderFlights();
        renderHosting();
      });
    });
    byId('flight-container').querySelectorAll('.remove-flight').forEach(button => {
      button.addEventListener('click', () => removeFlight(Number(button.dataset.index)));
    });
    state.flights.forEach((flight, index) => {
      if (!flight.pricing?.enabled) return;
      const prefix = `hf-${index}`;
      const render = () => {
        syncFlightPricingInputs(index);
        renderHosting();
      };
      bindPriceInputs(prefix, render);
      bindPriceLockControls(prefix, render);
    });
    renderFlightSum();
  }

  function createFlightMarkup(flight, index) {
    const removable = state.flights.length > 1;

    return `<div class="flight-block">
      <div class="flight-row">
        <label class="field">Flight ${index + 1}
          <input class="flight-name" data-index="${index}" type="text" value="${escapeAttribute(flight.name)}">
        </label>
        <label class="field">
          <span>Impressions %</span>
          <input class="flight-pct" data-index="${index}" type="text" inputmode="decimal" value="${escapeAttribute(flight.pct)}">
        </label>
        ${removable ? `<button class="remove-flight" type="button" data-index="${index}" title="Flight entfernen">${calculatorIcon('close')}</button>` : '<div></div>'}
      </div>
      <div class="flight-pricing-toolbar">
        <label class="toggle-line"><input class="flight-own-prices" type="checkbox" data-index="${index}"${flight.pricing?.enabled ? ' checked' : ''}><span></span>Eigene Preise</label>
        <span class="imp-hint" id="hf-${index}-netto-hint"></span>
        <span class="imp-hint" id="hf-${index}-impressions"></span>
      </div>
      ${flight.documentPosition ? `<div class="field-hint flight-document-source">Beleg: ${escapeHtml(flight.documentPosition.creative)} · ${escapeHtml([flight.documentPosition.start, flight.documentPosition.end].filter(Boolean).join(' – ') || 'Laufzeit offen')} · ${core.formatImpressions(flight.documentPosition.units)} gebuchte Imp.</div>` : ''}
      ${flight.pricing?.enabled ? createFlightPriceMarkup(flight.pricing, index) : ''}
    </div>`;
  }

  function createFlightPriceMarkup(pricing, index) {
    const prefix = `hf-${index}`;
    const priceField = field => {
      const label = `${PRICE_LOCK_LABELS[field]}${field === 'rabatt' ? ' %' : ' TKP'}`;
      return `<div class="field lockable-field" id="${prefix}-field-${field}" data-hosting-field="${field}">
        <div class="field-head"><label class="field-label" for="${prefix}-${field}">${label}</label></div>
        <div class="field-control">
          <input id="${prefix}-${field}" type="text" inputmode="decimal" value="${escapeAttribute(pricing.inputs[field])}">
          <button class="field-lock" type="button" data-hosting-lock="${field}" title="${label} fixieren" aria-label="${label} fixieren" aria-pressed="false"></button>
        </div>
      </div>`;
    };
    const optionField = field => `<div class="option-pair">
      <label class="toggle-line"><input id="${prefix}-use-${field}" type="checkbox"${pricing[field === 'bk' ? 'useBk' : 'useDbe'] ? ' checked' : ''}><span></span>${field.toUpperCase()} %</label>
      <label class="small-field"><input id="${prefix}-${field}" type="text" inputmode="decimal" aria-label="${field.toUpperCase()} Prozent" value="${escapeAttribute(pricing.inputs[field])}"></label>
    </div>`;
    return `<div class="flight-pricing" id="${prefix}-price-inputs">
      <div class="price-grid">${['brutto', 'rabatt', 'kundennetto', 'agenturnetto'].map(priceField).join('')}</div>
      <div class="bkdbe-grid">${optionField('bk')}${optionField('dbe')}<div></div>${priceField('netto')}</div>
      <div class="chain" id="${prefix}-chain"></div>
    </div>`;
  }

  function syncFlightPricingInputs(index) {
    const pricing = state.flights[index].pricing;
    const prefix = `hf-${index}`;
    pricing.inputs = Object.fromEntries(FLIGHT_PRICE_FIELDS.map(field => [field, getValue(`${prefix}-${field}`)]));
    pricing.useBk = byId(`${prefix}-use-bk`).checked;
    pricing.useDbe = byId(`${prefix}-use-dbe`).checked;
  }

  function renderFlightSum() {
    const total = state.flights.reduce((sum, flight) => sum + core.parseNumber(flight.pct), 0);
    const ok = Math.abs(total - 100) < 0.01;
    byId('flight-sum').innerHTML = `<span class="sum ${ok ? 'ok' : 'error'}">Summe: ${core.formatNumber(total, 2)}%</span>`;
  }

  function addFlight() {
    state.flights.push({ name: `Flight ${state.flights.length + 1}`, pct: 0 });
    renderFlights();
    renderHosting();
  }

  function removeFlight(index) {
    state.flights.splice(index, 1);
    renderFlights();
    renderHosting();
  }

  function getValue(id) {
    return byId(id).value;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }
})();
