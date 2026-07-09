import { runProjectMockPipeline } from "@droploop/pipeline";

const result = await runProjectMockPipeline({
  projectId: "demo-project",
  projectName: "Dark Melodic Techno Pack",
  template: "festival",
  musicGenre: "dark melodic techno",
  bpm: 126,
  showType: "festival LED wall",
  screenFormat: "16:9",
  packSize: 12,
  desiredMood: "black chrome cathedral, emotional blue lasers, cold mist",
  references: ["cathedral tunnel", "deep blue laser beams", "glass reflections"]
});

console.log(JSON.stringify(result, null, 2));
