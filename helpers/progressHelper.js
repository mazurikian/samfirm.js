const cliProgress = require("cli-progress");

const createProgressBar = (totalSize) => {
  const progressBar = new cliProgress.SingleBar(
    {
      format: "{bar} {percentage}% | {value}/{total} | {file}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic,
  );
  progressBar.start(totalSize, 0);
  return progressBar;
};

module.exports = {
  createProgressBar,
};
