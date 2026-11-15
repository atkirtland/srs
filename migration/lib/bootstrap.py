"""One-time conversion of imported metadata into editable study configuration."""
from collections import Counter
import _shared
import sources
from srs_tools.study import read, write, load_cards, validate
from srs_tools import layout

def native_options(manifest, deck):
    meta = manifest['scheduling']
    preset = meta['presets'][deck['normal'].get('config_id', '1')]
    settings = preset['settings']
    field = next((key for key in ('fsrs_params_6', 'fsrs_params_5', 'fsrs_params_4') if settings.get(key)), None)
    return dict(algorithm='FSRS-6', weights=settings.get(field, []), parameter_field=field,
                parameter_policy=meta['parameter_policy'], source_anki_version=meta['source_anki_version'],
                desired_retention=deck['normal'].get('desired_retention', settings['desired_retention']),
                maximum_interval=settings['maximum_review_interval'], minimum_interval=settings['minimum_lapse_interval'],
                learning_steps=settings['learn_steps'], relearning_steps=settings['relearn_steps'],
                new_cards_per_day=settings['new_per_day'], enable_fuzz=False,
                short_term_with_steps=bool(meta['collection'].get('fsrsShortTermWithStepsEnabled')))


def imported_profiles(manifest):
    meta = manifest['scheduling']
    profiles, assignments = {}, []
    for key, preset in meta['presets'].items():
        deck = next((d for d in meta['decks'].values() if d['normal'].get('config_id', '1') == key and not d.get('filtered')), None)
        if deck is None:
            continue
        # Deck retention overrides stay on imported cards, not on the shared preset.
        options = native_options(manifest, {**deck, 'normal': {'config_id': key}})
        profile = f"preset-{key}"
        profiles[profile] = {'name': preset.get('name', f'Imported preset {key}'), 'settings': options,
                             'reviews_per_day': preset['settings']['reviews_per_day'], 'imported_preset':key}
        assignments.append({'profile': profile, 'filter': {'deck_ids': [d['id'] for d in meta['decks'].values()
                              if d['normal'].get('config_id', '1') == key]}})
    if not profiles:
        raise ValueError('No scheduling presets found')
    return profiles, assignments


def initialize(data, config_path, output):
    """Create an editable transition configuration; never replace existing edits."""
    normalized = output.suffix != '.json'
    if (output / 'sources.json' if normalized else output).exists():
        raise ValueError(f"Already exists: {output}; edit it directly")
    manifest, cards = load_cards(data)
    config = layout.load_templates(config_path)
    meta = manifest['scheduling']
    profiles, assignments = imported_profiles(manifest)
    default = next(iter(profiles))
    rules = {}
    for group, definition in config['groups'].items():
        export = sources.EXPORTS.get(group)
        matching = [c for c in cards if c.get('group') == group]
        if export:
            paths = [export.notes_directory] if isinstance(export.notes_directory, str) else list(export.notes_directory)
            rule = dict(sources=paths, recursive=export.recursive,
                        fields=[{'anki': f.anki, 'source': f.source, 'transform': f.transform.__name__,
                                 'required': f.required, 'missing_source': f.missing_source} for f in export.fields])
            if export.filenames:
                rule['filenames'] = sorted(export.filenames)
            if export.required_property:
                rule['required_property'] = export.required_property
            if export.required_any_property:
                rule['required_any_property'] = list(export.required_any_property)
            if export.prepare_notes:
                rule['prepare'] = export.prepare_notes.__name__
        elif group == 'markdown-blocks':
            rule = dict(sources=['wiki'], recursive=True, kind='block', fields=[
                {'anki':'Front','source':'$front','transform':'text','required':True},
                {'anki':'Back','source':'$back','transform':'text','required':True}])
        else:
            continue
        counts = Counter(f"preset-{meta['decks'][c.get('original_deck_id') or c['deck_id']]['normal'].get('config_id', '1')}"
                         for c in matching if (c.get('original_deck_id') or c.get('deck_id')) in meta['decks'])
        notetype = export.notetype if export and export.notetype else Counter(c.get('anki_notetype') for c in matching).most_common(1)[0][0] if matching else None
        rule.update(templates=[t['key'] for t in definition['templates'] if not notetype or t['anki_notetype']==notetype], profile=counts.most_common(1)[0][0] if counts else default)
        rules[group] = rule
    result = dict(format_version=1, default_profile=default, profiles=profiles, profile_rules=assignments,
                  source_rules=rules, decks={key: {'name': d['name'], 'parent_id': d['parent_id'],
                      'filter': {'deck_ids': [key], 'include_children': True}}
                      for key, d in meta['decks'].items()})
    result['decks']['all']={'name':'All cards','parent_id':None,'filter':{}}
    validate(result)
    if normalized:
        if output.name != 'config':
            raise ValueError('Configuration directory must be named config')
        layout.upgrade(output.parent, data, configuration=result, templates=config)
    else:
        write(output, result)
    return result




def ensure_profiles(data, configuration):
    """Initialize missing active profiles for a new store using existing rules."""
    target=data/'profiles.json'
    if target.exists() or not (configuration/'sources.json').exists():
        return
    profiles,_=imported_profiles(read(data/'manifest.json'))
    references={r['profile'] for r in layout.load_templates(configuration).get('rules',{}).values()}
    references.update(r['profile'] for r in read(configuration/'profile-rules.json')['rules'])
    if references-set(profiles):
        raise ValueError('Restore data/profiles.json: configuration references custom profiles not present in the imported presets')
    write(target,dict(format_version=1,profiles=profiles,default_profile=next(iter(profiles))))
