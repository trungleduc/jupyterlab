import { init } from './utils';

init();

import { DebuggerSidebar } from '../src/sidebar';

describe('Test resize handler', () => {
  test('Should not modify normal heights', () => {
    const ret = DebuggerSidebar.computePanelHeightOnResize(
      [250, 250, 250, 250],
      25
    );
    expect(ret).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  test.each([
    [
      [20, 480, 250, 250],
      [0.025, 0.475, 0.25, 0.25]
    ],
    [
      [250, 20, 480, 250],
      [0.25, 0.025, 0.475, 0.25]
    ],
    [
      [250, 250, 20, 480],
      [0.25, 0.25, 0.025, 0.475]
    ],
    [
      [250, 250, 480, 20],
      [0.25, 0.25, 0.475, 0.025]
    ]
  ])(`Should modify array with one small value`, (inputArray, outputRatio) => {
    const ret = DebuggerSidebar.computePanelHeightOnResize(inputArray, 25);
    expect(ret).toEqual(outputRatio);
  });

  test.each([
    [
      [20, 20, 480, 480],
      [0.025, 0.025, 0.47, 0.48]
    ],
    [
      [480, 20, 20, 480],
      [0.48, 0.025, 0.025, 0.47]
    ],
    [
      [480, 480, 20, 20],
      [0.48, 0.47, 0.025, 0.025]
    ],
    [
      [20, 20, 20, 940],
      [0.025, 0.025, 0.025, 0.925]
    ]
  ])(
    `Should modify array with multiple small values`,
    (inputArray, outputRatio) => {
      const ret = DebuggerSidebar.computePanelHeightOnResize(inputArray, 25);
      expect(ret).toEqual(outputRatio);
    }
  );
});

describe('Test panel toggle handler', () => {
  test.each([
    [0, [0.025, 0.475, 0.25, 0.25]],
    [1, [0.25, 0.025, 0.475, 0.25]],
    [2, [0.25, 0.25, 0.025, 0.475]],
    [3, [0.25, 0.25, 0.475, 0.025]]
  ])('Toggle single panel at index %i', (idx, ratio) => {
    const ret = DebuggerSidebar.computePanelHeightOnToggle(
      [250, 250, 250, 250],
      idx,
      undefined,
      25
    );
    expect(ret.heightRatio).toEqual(ratio);
    expect(ret.heightToSave).toEqual(250);
  });

  test.each([
    [0, [0.025, 0.025, 0.025, 0.925], 250],
    [1, [0.25, 0.7, 0.025, 0.025], undefined],
    [2, [0.25, 0.025, 0.7, 0.025], undefined],
    [3, [0.925, 0.025, 0.025, 0.025], 700]
  ])('Toggle multiple panels at index %i', (idx, ratio, savedHeight) => {
    const ret = DebuggerSidebar.computePanelHeightOnToggle(
      [250, 25, 25, 700],
      idx,
      undefined,
      25
    );
    expect(ret.heightRatio).toEqual(ratio);
    expect(ret.heightToSave).toEqual(savedHeight);
  });
});
