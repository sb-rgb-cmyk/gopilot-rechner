(function initGoPilotCalculatorCore() {
  const DEFAULT_VAT_RATE = 8.1;

  function parseNumber(value) {
    const normalized = String(value ?? '')
      .replace(/['’\s]/g, '')
      .replace(',', '.')
      .trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value, maxDecimals) {
    const number = Number.parseFloat(Number(value || 0).toFixed(maxDecimals));
    return Number.isFinite(number) ? String(number) : '0';
  }

  function formatCurrency(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toFixed(2) : '0.00';
  }

  function formatImpressions(value) {
    return Math.round(value || 0).toLocaleString('de-CH');
  }

  function hasIncludedVatMarker(value) {
    return /\b(?:inkl\.?|inklusive|incl\.?|inclusive)\s*(?:mwst|mehrwertsteuer|vat)\b|\b(?:mwst|mehrwertsteuer|vat)\s*(?:inkl\.?|inklusive|incl\.?|inclusive)\b/i.test(String(value ?? ''));
  }

  function parseVatRate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return DEFAULT_VAT_RATE;

    const rate = parseNumber(raw);
    return rate > -100 ? rate : DEFAULT_VAT_RATE;
  }

  function removeIncludedVat(amount, vatRate) {
    const divisor = 1 + vatRate / 100;
    return divisor > 0 ? amount / divisor : amount;
  }

  function applyPercentReduction(amount, percent) {
    return amount * (1 - percent / 100);
  }

  function removePercentReduction(amount, percent) {
    const divisor = 1 - percent / 100;
    return divisor > 0 ? amount / divisor : 0;
  }

  function calculateVat(amountExVat, vatRate = DEFAULT_VAT_RATE) {
    const amount = Number(amountExVat || 0);
    const rate = parseVatRate(vatRate);
    const vatAmount = amount * (rate / 100);

    return {
      amount: vatAmount,
      rate,
      total: amount + vatAmount
    };
  }

  function getVatBase(result, input) {
    if (input.useDbe) return { amount: result.netto, label: 'Netto' };
    if (input.useBk) return { amount: result.agenturnetto, label: 'Agenturnetto' };
    return { amount: result.kundennetto, label: 'Kundennetto' };
  }

  function calculateForward({ brutto, rabatt, useBk, bk, useDbe, dbe }) {
    const kundennetto = applyPercentReduction(brutto, rabatt);
    const agenturnetto = useBk ? applyPercentReduction(kundennetto, bk) : kundennetto;
    const netto = useDbe ? applyPercentReduction(agenturnetto, dbe) : agenturnetto;
    return { brutto, rabatt, kundennetto, agenturnetto, netto };
  }

  function calculateFromKundennetto({ brutto, kundennetto, useBk, bk, useDbe, dbe }) {
    const rabatt = brutto > 0 ? ((brutto - kundennetto) / brutto) * 100 : 0;
    const agenturnetto = useBk ? applyPercentReduction(kundennetto, bk) : kundennetto;
    const netto = useDbe ? applyPercentReduction(agenturnetto, dbe) : agenturnetto;
    return { brutto, rabatt, kundennetto, agenturnetto, netto };
  }

  function calculateFromAgenturnetto({ brutto, agenturnetto, useBk, bk, useDbe, dbe }) {
    const kundennetto = useBk ? removePercentReduction(agenturnetto, bk) : agenturnetto;
    const rabatt = brutto > 0 ? ((brutto - kundennetto) / brutto) * 100 : 0;
    const netto = useDbe ? applyPercentReduction(agenturnetto, dbe) : agenturnetto;
    return { brutto, rabatt, kundennetto, agenturnetto, netto };
  }

  function calculateFromNetto({ brutto, netto, useBk, bk, useDbe, dbe }) {
    const agenturnetto = useDbe ? removePercentReduction(netto, dbe) : netto;
    const kundennetto = useBk ? removePercentReduction(agenturnetto, bk) : agenturnetto;
    const rabatt = brutto > 0 ? ((brutto - kundennetto) / brutto) * 100 : 0;
    return { brutto, rabatt, kundennetto, agenturnetto, netto };
  }

  function calculateFromKundennettoAndRabatt(input) {
    const brutto = removePercentReduction(input.kundennetto, input.rabatt);
    return {
      ...calculateFromKundennetto({ ...input, brutto }),
      bruttoComputed: true
    };
  }

  function calculateFromAgenturnettoAndRabatt(input) {
    const kundennetto = input.useBk
      ? removePercentReduction(input.agenturnetto, input.bk)
      : input.agenturnetto;
    const brutto = removePercentReduction(kundennetto, input.rabatt);
    return {
      ...calculateFromAgenturnetto({ ...input, brutto }),
      bruttoComputed: true
    };
  }

  function calculateFromNettoAndRabatt(input) {
    const agenturnetto = input.useDbe
      ? removePercentReduction(input.netto, input.dbe)
      : input.netto;
    const kundennetto = input.useBk
      ? removePercentReduction(agenturnetto, input.bk)
      : agenturnetto;
    const brutto = removePercentReduction(kundennetto, input.rabatt);
    return {
      ...calculateFromNetto({ ...input, brutto }),
      bruttoComputed: true
    };
  }

  function resolvePriceChain(input) {
    const anchor = input.anchor || 'rabatt';
    const vatRate = parseVatRate(input.vatRate);
    const anchorCanUseVat = ['brutto', 'kundennetto', 'agenturnetto', 'netto'].includes(anchor);
    const anchorHasVatMarker = anchorCanUseVat && hasIncludedVatMarker(input[anchor]);
    const inputAmountIsVatIncluded = anchorCanUseVat && (Boolean(input.useVat) || anchorHasVatMarker);
    const showVat = Boolean(input.useVat) || anchorHasVatMarker;

    function parsePrice(field) {
      const value = parseNumber(input[field]);
      return inputAmountIsVatIncluded && field === anchor
        ? removeIncludedVat(value, vatRate)
        : value;
    }

    const shared = {
      brutto: parsePrice('brutto'),
      rabatt: parseNumber(input.rabatt),
      kundennetto: parsePrice('kundennetto'),
      agenturnetto: parsePrice('agenturnetto'),
      netto: parsePrice('netto'),
      useBk: Boolean(input.useBk),
      bk: parseNumber(input.bk),
      useDbe: Boolean(input.useDbe),
      dbe: parseNumber(input.dbe)
    };

    const solveBruttoFromRabatt = Boolean(input.solveBruttoFromRabatt);
    const result = solveBruttoFromRabatt && anchor === 'kundennetto'
      ? calculateFromKundennettoAndRabatt(shared)
      : solveBruttoFromRabatt && anchor === 'agenturnetto'
      ? calculateFromAgenturnettoAndRabatt(shared)
      : solveBruttoFromRabatt && anchor === 'netto'
      ? calculateFromNettoAndRabatt(shared)
      : anchor === 'kundennetto'
      ? calculateFromKundennetto(shared)
      : anchor === 'agenturnetto'
      ? calculateFromAgenturnetto(shared)
      : anchor === 'netto'
      ? calculateFromNetto(shared)
      : calculateForward(shared);

    if (!showVat) return result;

    const vatBase = getVatBase(result, shared);

    return {
      ...result,
      vat: {
        ...calculateVat(vatBase.amount, vatRate),
        baseAmount: vatBase.amount,
        baseLabel: vatBase.label,
        inputAmountIsVatIncluded,
        inputAnchor: inputAmountIsVatIncluded ? anchor : ''
      }
    };
  }

  function calculateHosting(input) {
    const netto = parseNumber(input.netto);
    const budget = parseNumber(input.budget);
    const hostTkp = parseNumber(input.hostTkp);
    const production = parseNumber(input.production);
    const budgetForImpressions = budget - production;
    const flights = (input.flights || []).map(flight => ({
      name: String(flight.name || ''),
      pct: parseNumber(flight.pct),
      netto: flight.netto == null || String(flight.netto).trim() === '' ? netto : parseNumber(flight.netto)
    }));
    const mediaTkp = flights.length
      ? flights.reduce((sum, flight) => sum + flight.netto * flight.pct / 100, 0)
      : netto;
    const effectiveTkp = mediaTkp + hostTkp;
    const totalImpressions = effectiveTkp > 0 ? (budgetForImpressions / effectiveTkp) * 1000 : 0;
    const mediaAmount = (totalImpressions / 1000) * mediaTkp;
    const hostingAmount = (totalImpressions / 1000) * hostTkp;
    const total = mediaAmount + hostingAmount + production;

    return {
      budgetForImpressions,
      mediaTkp,
      effectiveTkp,
      totalImpressions,
      mediaAmount,
      hostingAmount,
      production,
      total,
      flights: flights.map(flight => {
        const impressions = totalImpressions * (flight.pct / 100);
        return {
          ...flight,
          impressions,
          amount: (impressions / 1000) * flight.netto
        };
      })
    };
  }

  function parseDistributionText(value) {
    return String(value ?? '')
      .trim()
      .split(/\/|\r?\n/)
      .map(part => part.trim())
      .filter(Boolean)
      .map(parseDistributionDimension)
      .filter(Boolean);
  }

  function parseDistributionDimension(part, index) {
    const matches = [...part.matchAll(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\s\-.]*?)\s+(\d+(?:[.,]\d+)?)\s*%/g)];
    if (!matches.length) return null;

    const positions = matches.map(match => ({
      name: match[1].trim(),
      pct: parseNumber(match[2])
    }));

    return {
      name: getDistributionDimensionNameFromPositions(positions, index),
      positions
    };
  }

  function getDistributionDimensionNameFromPositions(positions, index) {
    const name = positions.map(position => position.name).filter(Boolean).join('/');
    return name || `Dimension ${index + 1}`;
  }

  function getDefaultDistributionDependencyIndexes(dimensions) {
    const dimensionCount = Array.isArray(dimensions) ? dimensions.length : 0;
    const dependencySourceIndex = Math.max(0, dimensionCount - 1);
    const dependencyTargetIndex = 0;
    const extraDependencyTargetIndex = dimensionCount < 2
      ? 0
      : dependencySourceIndex === 1
        ? 0
        : 1;

    return {
      dependencySourceIndex,
      dependencyTargetIndex,
      extraDependencyTargetIndex
    };
  }

  function getDistributionDimensionSum(dimension) {
    return (dimension?.positions || []).reduce((sum, position) => sum + parseNumber(position.pct), 0);
  }

  function normalizeDistributionItems(items) {
    if (!Array.isArray(items) || !items.length) return;

    const sum = items.reduce((total, item) => total + parseNumber(item.pct), 0);
    if (!sum) return;

    items.forEach(item => {
      item.pct = Math.round(parseNumber(item.pct) / sum * 100);
    });
    const roundedSum = items.reduce((total, item) => total + parseNumber(item.pct), 0);
    items[items.length - 1].pct += 100 - roundedSum;
  }

  function getVisibleDistributionDimensions(distribution) {
    const dimensions = Array.isArray(distribution?.dimensions) ? distribution.dimensions : [];
    if (!distribution?.useAdvanced) return dimensions;

    return dimensions.filter((dimension, index) => index !== distribution.dependencyTargetIndex);
  }

  function getDisplayDistributionCombinations(combinations, distribution) {
    if (!distribution?.useAdvanced) return combinations;

    const hiddenDimensionIndex = distribution.dependencyTargetIndex;
    const grouped = new Map();

    combinations.forEach(combination => {
      const labels = combination.labels.filter(label => label.dimensionIndex !== hiddenDimensionIndex);
      const key = labels.map(label => `${label.dimensionIndex}:${label.positionIndex}`).join('|');
      const existing = grouped.get(key);
      if (existing) {
        existing.pct += combination.pct;
        return;
      }

      grouped.set(key, {
        labels,
        pct: combination.pct
      });
    });

    return [...grouped.values()];
  }

  function getDistributionCombinations(distribution) {
    const dimensions = Array.isArray(distribution?.dimensions) ? distribution.dimensions : [];
    const combinations = dimensions.reduce((currentCombinations, dimension, dimensionIndex) => {
      const next = [];
      currentCombinations.forEach(combination => {
        (dimension.positions || []).forEach((position, positionIndex) => {
          next.push({
            labels: [...combination.labels, {
              dimension: dimension.name,
              dimensionIndex,
              position: position.name,
              positionIndex
            }],
            pct: combination.pct * parseNumber(position.pct) / 100
          });
        });
      });
      return next;
    }, [{ labels: [], pct: 100 }]);

    const filtered = distribution?.useAdvanced
      ? combinations.filter(combination => isDistributionDependencyAllowed(combination, distribution))
      : combinations;
    const totalPct = filtered.reduce((sum, combination) => sum + combination.pct, 0);
    if (!totalPct) return [];

    return filtered.map(combination => ({
      ...combination,
      pct: combination.pct / totalPct * 100
    }));
  }

  function isDistributionDependencyAllowed(combination, distribution) {
    const sourceIndex = distribution.dependencySourceIndex;
    const targetIndex = distribution.dependencyTargetIndex;
    if (sourceIndex === targetIndex) return true;

    const sourceLabel = combination.labels.find(label => label.dimensionIndex === sourceIndex);
    return isDistributionDependencyMatch(combination, sourceLabel, targetIndex, distribution.dependencyMap)
      && (!distribution.useExtraDependency
        || isDistributionDependencyMatch(combination, sourceLabel, distribution.extraDependencyTargetIndex, distribution.extraDependencyMap));
  }

  function isDistributionDependencyMatch(combination, sourceLabel, targetIndex, dependencyMap) {
    const targetLabel = combination.labels.find(label => label.dimensionIndex === targetIndex);
    if (!sourceLabel || !targetLabel) return true;

    const allowedTargets = dependencyMap?.[String(sourceLabel.positionIndex)];
    if (!Array.isArray(allowedTargets) || !allowedTargets.length) return false;
    return allowedTargets.includes(targetLabel.positionIndex);
  }

  function buildDistributionDependencyMap({ dimensions, sourceIndex, targetIndex, currentMap }) {
    const sourceDimension = dimensions?.[sourceIndex];
    const targetDimension = dimensions?.[targetIndex];
    if (!sourceDimension || !targetDimension || sourceIndex === targetIndex) {
      return {};
    }

    const map = {};
    sourceDimension.positions.forEach((sourcePosition, sourcePositionIndex) => {
      const key = String(sourcePositionIndex);
      const existing = Array.isArray(currentMap?.[key])
        ? currentMap[key].filter(index => index >= 0 && index < targetDimension.positions.length)
        : [];
      map[key] = existing.length
        ? existing
        : getDefaultDistributionDependencyTargets(sourcePosition, targetDimension);
    });
    return map;
  }

  function getDefaultDistributionDependencyTargets(sourcePosition, targetDimension) {
    const sourceName = sourcePosition.name || '';
    const preferredPattern = /mobile/i.test(sourceName)
      ? /mobile/i
      : /desktop/i.test(sourceName)
        ? /desktop/i
        : null;

    if (preferredPattern) {
      const preferred = targetDimension.positions
        .map((targetPosition, index) => (preferredPattern.test(targetPosition.name || '') ? index : -1))
        .filter(index => index >= 0);
      if (preferred.length) return preferred;
    }

    return targetDimension.positions.map((position, index) => index);
  }

  globalThis.goPilotCalculatorCore = {
    buildDistributionDependencyMap,
    calculateHosting,
    calculateVat,
    DEFAULT_VAT_RATE,
    formatCurrency,
    formatImpressions,
    formatNumber,
    getDefaultDistributionDependencyIndexes,
    getDisplayDistributionCombinations,
    getDistributionCombinations,
    getDistributionDimensionSum,
    getVisibleDistributionDimensions,
    hasIncludedVatMarker,
    normalizeDistributionItems,
    parseDistributionText,
    parseNumber,
    resolvePriceChain
  };
})();
