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
