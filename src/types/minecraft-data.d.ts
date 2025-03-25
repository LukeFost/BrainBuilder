declare module 'minecraft-data' {
  export interface IndexedData {
    blocks: { [id: number]: Block };
    blocksByName: { [name: string]: Block };
    items: { [id: number]: Item };
    itemsByName: { [name: string]: Item };
    foods: { [id: number]: Food };
    foodsByName: { [name: string]: Food };
    entities: { [id: number]: Entity };
    entitiesByName: { [name: string]: Entity };
    biomes: { [id: number]: Biome };
    biomesByName: { [name: string]: Biome };
    recipes: Recipe[];
    instruments: Instrument[];
    materials: { [name: string]: Material };
    enchantments: { [id: number]: Enchantment };
    enchantmentsByName: { [name: string]: Enchantment };
    [key: string]: any;
  }

  export interface Block {
    id: number;
    displayName: string;
    name: string;
    hardness: number;
    stackSize: number;
    diggable: boolean;
    boundingBox: string;
    material?: string;
    harvestTools?: { [id: number]: boolean };
    variations?: any[];
    drops?: any[];
    states?: any[];
    transparent?: boolean;
    emitLight?: number;
    filterLight?: number;
    resistance?: number;
    [key: string]: any;
  }

  export interface Item {
    id: number;
    displayName: string;
    name: string;
    stackSize: number;
    [key: string]: any;
  }

  export interface Food {
    id: number;
    displayName: string;
    name: string;
    stackSize: number;
    foodPoints: number;
    saturation: number;
    [key: string]: any;
  }

  export interface Entity {
    id: number;
    name: string;
    displayName: string;
    width: number;
    height: number;
    type: string;
    [key: string]: any;
  }

  export interface Biome {
    id: number;
    name: string;
    [key: string]: any;
  }

  export interface Recipe {
    result: Item;
    ingredients: Item[];
    [key: string]: any;
  }

  export interface Instrument {
    id: number;
    name: string;
    [key: string]: any;
  }

  export interface Material {
    [key: string]: any;
  }

  export interface Enchantment {
    id: number;
    name: string;
    displayName: string;
    maxLevel: number;
    [key: string]: any;
  }

  function minecraftData(version: string | number): IndexedData;
  
  namespace minecraftData {
    export function supportedVersions(): string[];
    export function getVersionData(version: string | number): IndexedData;
    export function findItemOrBlockByName(name: string, version: string | number): Item | Block | null;
  }
  
}
