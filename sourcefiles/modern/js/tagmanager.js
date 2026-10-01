function initTagManager() {
	const manager = $('#tagmanager');
	if (!manager.length) return;
	const error = manager.find('#tagmanager-error');
	const renameDialog = manager.find('#tagmanager-rename');
	const renameError = manager.find('#tagmanager-rename-error');
	const deleteDialog = manager.find('#tagmanager-delete-dialog');
	const deleteError = manager.find('#tagmanager-delete-error');
	let pending = false;
	let renameRow = null;
	let deleteRow = null;

	function showError(message) {
		(deleteRow ? deleteError : renameRow ? renameError : error).text(message || manager.attr('data-error')).show();
	}

	function formatTag(tag) {
		return tag.trim().replace(/ /g, '_');
	}

	function showUsage(cell, usage) {
		cell.empty();
		if (!usage) {
			cell.text(manager.attr('data-usage-unknown'));
		} else if (!usage.timers && !usage.movies && !usage.autotimers) {
			cell.text(manager.attr('data-not-used'));
		} else {
			for (const [key, label] of [['timers', 'data-label-timers'], ['movies', 'data-label-recordings'], ['autotimers', 'data-label-autotimers']]) {
				if (usage[key]) cell.append($('<div>').text(manager.attr(label) + ': ' + usage[key]));
			}
		}
	}

	function addRow(tag, usage) {
		const row = $('<tr>').attr('data-tag', tag);
		row.append($('<td>').addClass('tagmanager-label').css('white-space', 'pre-wrap').text(tag.replace(/_/g, ' ')));
		const usageCell = $('<td>').addClass('tagmanager-usage');
		showUsage(usageCell, usage);
		row.append(usageCell);
		const actions = $('<td>').addClass('text-right').css('white-space', 'nowrap');
		for (const [action, icon] of [['edit', 'edit'], ['delete', 'delete']]) {
			actions.append($('<button>').attr('type', 'button').addClass('btn btn-default tagmanager-' + action)
				.attr('title', manager.attr('data-' + action + '-title'))
				.append($('<i>').addClass('material-icons').text(icon)));
		}
		row.append(actions);
		manager.find('tbody').append(row);
	}

	function submitTag(action, tag, newtag, row, updateUses) {
		if (pending) return;
		if (action === 'add') tag = formatTag(tag);
		if (action === 'rename') newtag = formatTag(newtag);
		const value = action === 'rename' ? newtag : tag;
		if (!value || value.length > 100 || /[\s\x00-\x1f\x7f]/.test(value)) {
			showError(manager.attr('data-invalid'));
			return;
		}
		pending = true;
		error.hide();
		renameError.hide();
		deleteError.hide();
		manager.find('button, input').prop('disabled', true);
		const data = {action: action, tag: tag};
		if (action === 'rename') data.newtag = newtag;
		if (updateUses && (action === 'rename' || action === 'delete')) data.updateuses = '1';
		$.ajax({
			url: '/api/tagmanager',
			type: 'POST',
			dataType: 'json',
			data: data
		}).done(function(response) {
			if (!response || !response.result) {
				showError(response && response.message);
				return;
			}
			if (document.getElementById('tagmanager') !== manager[0]) return;
			if (action === 'add') {
				addRow(tag, response.usage);
				manager.find('#tagmanager-name').val('');
			} else if (action === 'rename') {
				row.attr('data-tag', newtag);
				row.find('.tagmanager-label').text(newtag.replace(/_/g, ' '));
				showUsage(row.find('.tagmanager-usage'), response.usage);
				renameDialog.modal('hide');
			} else {
				row.remove();
				deleteDialog.modal('hide');
			}
		}).fail(function(xhr) {
			showError(xhr.responseJSON && xhr.responseJSON.message);
		}).always(function() {
			pending = false;
			manager.find('button, input').prop('disabled', false);
		});
	}

	renameDialog.off('.tagmanager').on('shown.bs.modal.tagmanager', function() {
		manager.find('#tagmanager-rename-name').focus();
	}).on('hidden.bs.modal.tagmanager', function() {
		renameRow = null;
	});
	deleteDialog.off('.tagmanager').on('hidden.bs.modal.tagmanager', function() {
		deleteRow = null;
	});

	function renameTag(updateUses) {
		if (pending || !renameRow) return;
		const tag = renameRow.attr('data-tag');
		const value = manager.find('#tagmanager-rename-name').val();
		if (value === tag.replace(/_/g, ' ') || formatTag(value) === tag) {
			renameDialog.modal('hide');
			return;
		}
		submitTag('rename', tag, value, renameRow, updateUses);
	}

	manager.off('.tagmanager').on('submit.tagmanager', '#tagmanager-add', function(event) {
		event.preventDefault();
		submitTag('add', manager.find('#tagmanager-name').val());
	}).on('click.tagmanager', '.tagmanager-edit', function() {
		if (pending) return;
		renameRow = $(this).closest('tr');
		manager.find('#tagmanager-rename-name').val(renameRow.attr('data-tag').replace(/_/g, ' '));
		renameError.hide();
		renameDialog.modal('show');
	}).on('submit.tagmanager', '#tagmanager-rename-form', function(event) {
		event.preventDefault();
		renameTag(false);
	}).on('click.tagmanager', '#tagmanager-rename-update', function() {
		renameTag(true);
	}).on('click.tagmanager', '.tagmanager-delete', function() {
		if (pending) return;
		deleteRow = $(this).closest('tr');
		manager.find('#tagmanager-delete-name').text(deleteRow.attr('data-tag').replace(/_/g, ' '));
		deleteError.hide();
		deleteDialog.modal('show');
	}).on('click.tagmanager', '#tagmanager-delete-confirm', function() {
		if (deleteRow) submitTag('delete', deleteRow.attr('data-tag'), null, deleteRow);
	}).on('click.tagmanager', '#tagmanager-delete-update', function() {
		if (deleteRow) submitTag('delete', deleteRow.attr('data-tag'), null, deleteRow, true);
	});
}