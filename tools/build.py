"""Rebuild the standalone reviewer without Node or package installation."""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
from srs_tools.configuration import US_STATES_BY_SLUG
hook = '''
  if (globalThis.__SRS_TEST__) {
    globalThis.SRS = {sourceBlocks, validateStudy, validateStudyFilter, matchesStudyFilter, studyProfileId, studyRuntimeManifest, studyDeckTree, studyDeckMatches, schedulerV2, effectiveSettings, renderV2, transformField, fieldsFromNote,
      deckTree, queueKind, reviewQueueV2, nextStateV2, studyDay, studyDayStart, dayNumber, cardSuspended,
      ReviewIndex, appendReview, validateEvent, saveSchedulerConfig, verifySchedulerConfig, parseCSV, indexRows, configuredCards, initialState};
    return;
  }
'''
(HERE.parent / "view.js").write_text(
    (HERE / "browser/browser-base.js").read_text() + "\nconst US_STATES = " + json.dumps(US_STATES_BY_SLUG) + ";\n" +
    (HERE / "browser/browser-v2.js").read_text() + (HERE / "browser/browser-study.js").read_text() + hook +
    (HERE / "browser/browser-view.js").read_text() + "\n})();\n")
