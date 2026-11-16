"""Rebuild the standalone reviewer without Node or package installation."""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
from srs_tools.configuration import US_STATES_BY_SLUG
yaml_bundle = "\nconst SRSYaml = (() => { const module = {exports: {}}, exports = module.exports, define = undefined;\n" + (HERE / "browser/vendor/js-yaml-5.5.0.js").read_text() + "\nreturn module.exports; })();\n"
hook = '''
  if (globalThis.__SRS_TEST__) {
    globalThis.SRS = {maintenanceFileChoices,maintenanceMetadata,CardMaintenance, MaintenanceCache, maintenanceIdentity, maintenanceCardId, maintenanceQuestion, CatalogPublisher,ReviewerSessionCache, CatalogCache, ContentCheckProgress, preparePresidents, groupContentErrors, SchedulingIndex, SchedulingOrder, readCatalogPartitions, studyMemberships, composeStudyDocuments, hydrateCatalog, sourceBlocks, validateStudy, validateStudyFilter, matchesStudyFilter, studyProfileId, studyRuntimeManifest, studyDeckTree, studyDeckMatches, studyFilterNeedsMetadata, schedulerV2, effectiveSettings, renderV2, templateScriptParts, runTemplateScripts, resolveImageEmbeds, transformField, fieldsFromNote,
      deckTree, queueKind, reviewQueueV2, reviewIntervalLabel, nextStateV2, studyDay, studyDayStart, dayNumber, cardSuspended,
      ReviewIndex, appendReview, validateEvent, saveSchedulerConfig, verifySchedulerConfig, parseCSV, indexRows, configuredCards, initialState};
    return;
  }
'''
(HERE.parent / "view.js").write_text(
    (HERE / "browser/browser-base.js").read_text() + "\nconst US_STATES = " + json.dumps(US_STATES_BY_SLUG) + ";\n" +
    (HERE / "browser/browser-v2.js").read_text() + (HERE / "browser/browser-study.js").read_text() + (HERE / "browser/browser-scheduling-index.js").read_text() + yaml_bundle + (HERE / "browser/browser-maintenance.js").read_text() + hook +
    (HERE / "browser/browser-view.js").read_text() + "\n})();\n")
