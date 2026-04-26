import { create } from "zustand";
import type { SessionTemplate } from "../lib/types";
import {
  dbSaveTemplate,
  dbLoadAllTemplates,
  dbDeleteTemplate,
} from "../lib/tauri";

interface TemplateStore {
  templates: Record<string, SessionTemplate>;
  loadTemplates: () => Promise<void>;
  createTemplate: (name: string, workingDir: string, flags: string[], envVars: Record<string, string>) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<Pick<SessionTemplate, "name" | "workingDir" | "flags" | "envVars">>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

export const useTemplateStore = create<TemplateStore>((set) => ({
  templates: {},

  loadTemplates: async () => {
    const templates = await dbLoadAllTemplates();
    const map: Record<string, SessionTemplate> = {};
    for (const t of templates) map[t.id] = t;
    set({ templates: map });
  },

  createTemplate: async (name: string, workingDir: string, flags: string[], envVars: Record<string, string>) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const template: SessionTemplate = {
      id,
      name,
      workingDir,
      flags,
      envVars,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ templates: { ...s.templates, [id]: template } }));
    await dbSaveTemplate(template);
  },

  updateTemplate: async (id: string, updates: Partial<Pick<SessionTemplate, "name" | "workingDir" | "flags" | "envVars">>) => {
    set((s) => {
      const tmpl = s.templates[id];
      if (!tmpl) return s;
      const updated = { ...tmpl, ...updates, updatedAt: Date.now() };
      dbSaveTemplate(updated).catch(console.error);
      return { templates: { ...s.templates, [id]: updated } };
    });
  },

  deleteTemplate: async (id: string) => {
    set((s) => {
      const { [id]: _, ...rest } = s.templates;
      return { templates: rest };
    });
    await dbDeleteTemplate(id);
  },
}));
