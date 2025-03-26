
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
import { craftItemAction } from './craftItem';
import { collectBlockAction } from './collectBlock';
import { sleepAction } from './sleep';
import { wakeUpAction } from './wakeUp';

export const actions = {
  collectBlock: collectBlockAction,
  craftItem: craftItemAction,
  sleep: sleepAction,
  wakeUp: wakeUpAction,
};
import { Action } from '../types';
import { askForHelpAction } from './askForHelp';
import { attackEntityAction } from './attackEntity';
import { collectBlockAction } from './collectBlock';
import { dropItemAction } from './dropItem';
import { craftItemAction } from './craftItem';
import { lookAroundAction } from './lookAround';
import { moveToPositionAction } from './moveToPosition';
import { placeBlockAction } from './placeBlock';
import { generateAndExecuteCodeAction } from './generateAndExecuteCode';
import { sleepAction } from './sleep';
import { wakeUpAction } from './wakeUp';

/**
 * Export all actions as a record for easy access
 * This allows us to dynamically select actions by name
 */
export const actions: Record<string, Action> = {
  askForHelp: askForHelpAction,
  attackEntity: attackEntityAction,
  collectBlock: collectBlockAction,
  dropItem: dropItemAction,
  craftItem: craftItemAction,
  lookAround: lookAroundAction,
  moveToPosition: moveToPositionAction,
  placeBlock: placeBlockAction,
  generateAndExecuteCode: generateAndExecuteCodeAction,
  sleep: sleepAction,
  wakeUp: wakeUpAction
};
