export const plants = Object.freeze([
  { id: 'daisy', name: 'Daisy', color: '#f2c95f' },
  { id: 'poppy', name: 'Poppy', color: '#d97970' },
  { id: 'lavender', name: 'Lavender', color: '#a494c4' },
  { id: 'bluebell', name: 'Bluebell', color: '#7fa4c9' },
  { id: 'fern', name: 'Fern', color: '#6b9a6c' },
  { id: 'rose', name: 'Rose', color: '#c47d9b' }
]);

export function getGardenView(state, totalCompletions) {
  const unlockedPlots = Math.min(48, 4 + Math.floor(totalCompletions / 5) * 4);
  const stored = Array.isArray(state.garden?.plots) ? state.garden.plots : [];
  const valid = new Map();
  for (const item of stored) {
    if (Number.isInteger(item?.index) && item.index >= 0 && item.index < unlockedPlots && plants.some(plant => plant.id === item.plantId)) valid.set(item.index, item);
  }
  const plots = Array.from({ length: unlockedPlots }, (_, index) => {
    const planted = valid.get(index);
    const plant = plants.find(candidate => candidate.id === planted?.plantId);
    const age = planted ? Math.max(0, totalCompletions - (planted.plantedAt || 0)) : 0;
    return { index, plantId: plant?.id || null, name: plant?.name || 'Empty plot', color: plant?.color || '',
      stage: !plant ? 'empty' : age >= 5 ? 'blooming' : age >= 2 ? 'growing' : 'seedling', plantedAt: planted?.plantedAt ?? totalCompletions };
  });
  return { plants: plants.map(plant => ({ ...plant })), plots,
    seedCredits: Math.max(0, 1 + totalCompletions - valid.size), unlockedPlots,
    unlockedAreas: Math.ceil(unlockedPlots / 4), nextPlotAt: unlockedPlots === 48 ? null : (Math.floor(totalCompletions / 5) + 1) * 5 };
}
