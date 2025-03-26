
import { Action } from '../types'; // Assuming Action type is in ../types

// Import individual actions
import { collectBlockAction } from './collectBlock';
import { moveToPositionAction } from './moveToPosition';
import { craftItemAction } from './craftItem';
import { lookAroundAction } from './lookAround';
import { attackEntityAction } from './attackEntity';
import { placeBlockAction } from './placeBlock';
import { sleepAction } from './sleep';
import { wakeUpAction } from './wakeUp';
import { dropItemAction } from './dropItem';
import { askForHelpAction } from './askForHelp';
import { generateAndExecuteCodeAction } from './generateAndExecuteCode';

// Export actions map
export const actions: Record<string, Action> = {
  collectBlock: collectBlockAction,
  moveToPosition: moveToPositionAction,
  craftItem: craftItemAction,
  lookAround: lookAroundAction,
  attackEntity: attackEntityAction,
  placeBlock: placeBlockAction,
  sleep: sleepAction,
  wakeUp: wakeUpAction,
  dropItem: dropItemAction,
  askForHelp: askForHelpAction,
  generateAndExecuteCode: generateAndExecuteCodeAction,
};
