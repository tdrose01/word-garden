export const plants = Object.freeze([
  { id: 'daisy', name: 'Daisy', color: '#f2c95f' },
  { id: 'poppy', name: 'Poppy', color: '#d97970' },
  { id: 'lavender', name: 'Lavender', color: '#a494c4' },
  { id: 'bluebell', name: 'Bluebell', color: '#7fa4c9' },
  { id: 'fern', name: 'Fern', color: '#6b9a6c' },
  { id: 'rose', name: 'Rose', color: '#c47d9b' }
]);

export const gardenDesigns = Object.freeze([
  { id: 'meadow', name: 'Meadow', blooms: 0 },
  { id: 'moonlit', name: 'Moonlit Garden', blooms: 3 },
  { id: 'sunroom', name: 'Sunroom', blooms: 6 }
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
      stage: !plant ? 'empty' : age >= 5 ? 'blooming' : age >= 2 ? 'growing' : 'seedling', plantedAt: planted?.plantedAt ?? totalCompletions, bloomCollected: planted?.bloomCollected === true };
  });
  const collectedBloomCount = Math.max(0, Math.floor(state.garden?.collectedBloomCount || 0));
  const collectedSpecies = plants.filter(plant => state.garden?.collectedSpecies?.includes(plant.id)).map(plant => plant.id);
  const seedsSpent = Math.max(valid.size, Math.floor(state.garden?.seedsSpent || 0));
  const designs = gardenDesigns.map(design => ({ ...design, unlocked: collectedBloomCount >= design.blooms }));
  const design = designs.find(design => design.id === state.garden?.design && design.unlocked)?.id || 'meadow';
  return { collectedBloomCount, collectedSpecies, seedsSpent, designs, design,
    readyBlooms: plots.filter(plot => plot.stage === 'blooming' && !plot.bloomCollected).length, plants: plants.map(plant => ({ ...plant })), plots,
    seedCredits: Math.max(0, 1 + totalCompletions - seedsSpent), unlockedPlots,
    unlockedAreas: Math.ceil(unlockedPlots / 4), nextPlotAt: unlockedPlots === 48 ? null : (Math.floor(totalCompletions / 5) + 1) * 5 };
}
