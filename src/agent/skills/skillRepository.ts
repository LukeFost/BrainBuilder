import * as fs from 'fs/promises';
import * as path from 'path';

export interface Skill {
  name: string; // Unique name for the skill
  description: string; // Natural language description for the LLM planner
  parameters: string[]; // List of parameter names the skill's code expects
  code: string; // The raw JavaScript code block (just the inner part, not the full function wrapper)
}

export class SkillRepository {
  private skills: Map<string, Skill> = new Map();
  private readonly filePath: string;

  constructor(filename: string = 'skills_library.json') {
    // Store file in the project root directory relative to dist/agent/skills/skillRepository.js
    // Adjust if your build structure is different
    this.filePath = path.join(__dirname, '..', '..', '..', filename);
  }

  async loadSkills(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const loadedSkills = JSON.parse(data) as Skill[];
      this.skills.clear();
      loadedSkills.forEach(skill => {
        if (skill.name && skill.description && Array.isArray(skill.parameters) && skill.code) {
          this.skills.set(skill.name, skill);
        } else {
          console.warn(`[SkillRepository] Skipping invalid skill entry during load: ${JSON.stringify(skill)}`);
        }
      });
      console.log(`[SkillRepository] Loaded ${this.skills.size} skills from ${this.filePath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`[SkillRepository] No skills file found at ${this.filePath}. Starting with empty library.`);
        this.skills.clear();
      } else {
        console.error(`[SkillRepository] Error loading skills from ${this.filePath}:`, error);
      }
    }
  }

  async saveSkills(): Promise<void> {
    try {
      const skillsArray = Array.from(this.skills.values());
      const data = JSON.stringify(skillsArray, null, 2);
      await fs.writeFile(this.filePath, data, 'utf8');
      // console.log(`[SkillRepository] Saved ${this.skills.size} skills to ${this.filePath}`); // Optional log
    } catch (error) {
      console.error(`[SkillRepository] Error saving skills to ${this.filePath}:`, error);
    }
  }

  addSkill(skill: Skill): boolean {
    if (!skill.name || !skill.description || !Array.isArray(skill.parameters) || !skill.code) {
        console.error(`[SkillRepository] Cannot add skill: Invalid skill structure for "${skill.name || 'Unnamed Skill'}".`);
        return false;
    }
    if (this.skills.has(skill.name)) {
      console.error(`[SkillRepository] Cannot add skill: Skill "${skill.name}" already exists.`);
      return false;
    }
    this.skills.set(skill.name, skill);
    console.log(`[SkillRepository] Added skill: ${skill.name}`);
    this.saveSkills(); // Auto-save on add
    return true;
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  // Optional: Method to remove skills
  removeSkill(name: string): boolean {
      if (this.skills.delete(name)) {
          console.log(`[SkillRepository] Removed skill: ${name}`);
          this.saveSkills();
          return true;
      }
      return false;
  }
}
