##########################################################################
# OpenWebif: tagmanager
##########################################################################
# Copyright (C) 2026 E2OpenPlugins
#
# This program is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software Foundation,
# Inc., 51 Franklin Street, Fifth Floor, Boston MA 02110-1301, USA.
##########################################################################

from os import chmod, replace, stat, unlink
from os.path import dirname, exists
from stat import S_IMODE
from tempfile import NamedTemporaryFile
from xml.etree import ElementTree


MOVIETAGFILE = '/etc/enigma2/movietags'
AUTOTIMERFILE = '/etc/enigma2/autotimer.xml'


def format_tag(tag):
	return tag.strip().replace(' ', '_')


def get_known_tags(filename=MOVIETAGFILE):
	if not exists(filename):
		return []
	with open(filename, encoding='utf-8') as file:
		return list(dict.fromkeys(format_tag(tag) for tag in file if tag.strip()))


def _updated_known_tags(action, tag, new_tag, filename):
	def valid(value):
		return isinstance(value, str) and bool(value) and len(value) <= 100 and not any(
			character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value)

	if isinstance(tag, str):
		tag = format_tag(tag)
	if isinstance(new_tag, str):
		new_tag = format_tag(new_tag)

	if action not in ('add', 'rename', 'delete') or not valid(tag) or (action == 'rename' and not valid(new_tag)):
		raise ValueError('Invalid tag')

	tags = get_known_tags(filename)
	if action == 'add':
		if tag in tags:
			raise ValueError('Tag already exists')
		tags.append(tag)
	else:
		if tag not in tags:
			raise ValueError('Tag not found')
		if action == 'rename':
			if new_tag in tags:
				raise ValueError('Tag already exists')
			tags[tags.index(tag)] = new_tag
		else:
			tags.remove(tag)
	return tags


def _write_atomic(filename, content):
	tmpname = None
	try:
		with NamedTemporaryFile(mode='wb', dir=dirname(filename), delete=False) as file:
			tmpname = file.name
			file.write(content)
		chmod(tmpname, S_IMODE(stat(filename).st_mode) if exists(filename) else 0o644)
		replace(tmpname, filename)
	finally:
		if tmpname is not None and exists(tmpname):
			unlink(tmpname)


def update_known_tags(action, tag, new_tag=None, filename=MOVIETAGFILE):
	tags = _updated_known_tags(action, tag, new_tag, filename)
	_write_atomic(filename, '\n'.join(tags).encode('utf-8'))
	return tags


def _replace_tags(tags, old, new):
	if new is None:
		return [tag for tag in tags if tag != old]
	updated = []
	for tag in tags:
		value = new if tag == old else tag
		if value != new or value not in updated:
			updated.append(value)
	return updated


def _updated_autotimers(filename, old, new):
	if not exists(filename):
		return None, 0
	parser = ElementTree.XMLParser(target=ElementTree.TreeBuilder(insert_comments=True))
	tree = ElementTree.parse(filename, parser=parser)
	count = 0
	for timer in tree.getroot().iter('timer'):
		changed = False
		if 'tags' in timer.attrib:
			tags = timer.get('tags').split()
			if old in tags:
				timer.set('tags', ' '.join(_replace_tags(tags, old, new)))
				changed = True
		for element in timer.iter('tags'):
			tags = (element.text or '').split()
			if old in tags:
				element.text = ' '.join(_replace_tags(tags, old, new))
				changed = True
		seen = set()
		for parent in timer.iter():
			for element in list(parent):
				if element.tag != 'tag':
					continue
				if new is None and element.text == old:
					parent.remove(element)
					changed = True
					continue
				value = new if element.text == old else element.text
				if element.text == old:
					element.text = new
					changed = True
				if value == new and value in seen and changed:
					parent.remove(element)
				elif value == new:
					seen.add(value)
		if changed:
			count += 1
	if not count:
		return None, 0
	return ElementTree.tostring(tree.getroot(), encoding='utf-8', xml_declaration=True), count


def _get_recordings(locations):
	from .movies import getMovieList
	movies = {}
	for location in locations or [None]:
		args = {b'fields': [b'tags'], b'recursive': [b'1']}
		if location is not None:
			args[b'dirname'] = [location.encode('utf-8')]
		listing = getMovieList(rargs=args, directory=location)
		for movie in listing['movies']:
			movies[movie['filename']] = movie
	return list(movies.values())


def rename_tag_and_uses(tag, new_tag, session, locations, filename=MOVIETAGFILE, autotimer_file=AUTOTIMERFILE):
	return _update_tag_and_uses('rename', tag, new_tag, session, locations, filename, autotimer_file)


def delete_tag_and_uses(tag, session, locations, filename=MOVIETAGFILE, autotimer_file=AUTOTIMERFILE):
	return _update_tag_and_uses('delete', tag, None, session, locations, filename, autotimer_file)


def _update_tag_and_uses(action, tag, new_tag, session, locations, filename, autotimer_file):
	tags = _updated_known_tags(action, tag, new_tag, filename)
	old, new = format_tag(tag), format_tag(new_tag) if action == 'rename' else None
	movies = _get_recordings(locations)
	meta_updates = {}
	for movie in movies:
		metafile = movie['filename'] + '.meta'
		if not exists(metafile):
			if old in (movie.get('tags') or '').split():
				raise OSError('Recording metadata missing: %s' % metafile)
			continue
		with open(metafile, 'r', encoding='utf-8', errors='surrogateescape', newline='') as file:
			lines = file.readlines()
		if len(lines) < 5:
			if old in (movie.get('tags') or '').split():
				raise ValueError('Recording metadata has no tags line: %s' % metafile)
			continue
		value = lines[4].rstrip('\r\n')
		if old not in value.split():
			if old in (movie.get('tags') or '').split():
				raise ValueError('Recording tags differ from metadata: %s' % metafile)
			continue
		lines[4] = ' '.join(_replace_tags(value.split(), old, new)) + lines[4][len(value):]
		meta_updates[metafile] = ''.join(lines).encode('utf-8', errors='surrogateescape')

	xml_content, auto_count = _updated_autotimers(autotimer_file, old, new)
	rt = session.nav.RecordTimer
	timer_updates = []
	for timer in rt.timer_list + rt.processed_timers:
		if old in timer.tags:
			timer_updates.append((timer, timer.tags[:], _replace_tags(timer.tags, old, new)))

	# Save the live timer list first: if it fails no files have been changed.
	if timer_updates:
		try:
			for timer, previous, updated in timer_updates:
				timer.tags = updated
			rt.saveTimer()
		except Exception:
			for timer, previous, updated in timer_updates:
				timer.tags = previous
			raise
	try:
		for metafile, content in meta_updates.items():
			_write_atomic(metafile, content)
		if xml_content is not None:
			_write_atomic(autotimer_file, xml_content)
			try:
				from Plugins.Extensions.AutoTimer.plugin import autotimer
			except ImportError:
				pass
			else:
				if autotimer is not None:
					autotimer.configMtime = -1
					autotimer.readXml()
		_write_atomic(filename, '\n'.join(tags).encode('utf-8'))
	except Exception as err:
		raise OSError('Tag %s incomplete; some uses may already be updated: %s' % (action, err)) from err
	return {'tags': tags, 'updated': {'timers': len(timer_updates), 'movies': len(meta_updates), 'autotimers': auto_count}}


def get_tag_usage(tags, timers, movies, autotimer_file=AUTOTIMERFILE):
	usage = {tag: {'timers': 0, 'movies': 0, 'autotimers': 0} for tag in tags}
	for key, entries in (('timers', timers), ('movies', movies)):
		for entry in entries:
			for tag in set((entry.get('tags') or '').split()):
				if tag in usage:
					usage[tag][key] += 1
	if exists(autotimer_file):
		for timer in ElementTree.parse(autotimer_file).getroot().iter('timer'):
			auto_tags = {element.text for element in timer.iter('tag')}
			auto_tags.update((timer.get('tags') or '').split())
			for element in timer.iter('tags'):
				auto_tags.update((element.text or '').split())
			for tag in auto_tags:
				if tag in usage:
					usage[tag]['autotimers'] += 1
	return usage


def get_tag_usage_for_session(tags, session, locations):
	if not tags:
		return {}
	from .timers import getTimers
	movies = _get_recordings(locations)
	return get_tag_usage(tags, getTimers(session)['timers'], movies)
