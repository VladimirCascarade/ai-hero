export const regressionData = [
  {
    input:
      "How do I pnpm upgrade only a certain set of dependencies - ones starting with @tanstack",
    expected: `pnpm upgrade "@tanstack/*"`,
  },
  {
    input: "How do you do a 404 page in tanstack start?",
    expected: `\nimport { createRouter, Link } from '@tanstack/react-router'\n\nconst router = createRouter({\n  defaultNotFoundComponent: () => {\n    return (\n      <div>\n        <p>Not found!</p>\n        <Link to=\"/\">Go home</Link>\n      </div>\n    )\n  },\n})\n`,
  },
  {
    input: "How do I export subtitles from DaVinci Resolve?",
    expected: `Exporting Subtitles as a Separate File (SRT):\n\nDeliver Page: Go to the Deliver page in DaVinci Resolve.\nRender Settings: In the \"Render Settings\" panel, make sure to check the \"Export Subtitle\" option.\nFormat: Choose \"Subtitle Files (*.srt)\" or your desired format. SRT is widely compatible.\nBurn into Video: Uncheck the \"Burn into video\" option if you want a separate subtitle file.\nExport: Add the job to the render queue and render. DaVinci Resolve will create both the video file and a separate .srt file.`,
  },
];
