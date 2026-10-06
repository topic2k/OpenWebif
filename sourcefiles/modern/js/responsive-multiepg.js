var reloadTimers = false;

(function(root) {
	var disposeCurrent;

	function resizeModernEpgCard() {
		var card = jQuery('#epgcard');
		if (!card.length) return;
		var cardTop = card[0].getBoundingClientRect().top;
		var table = jQuery('#fulltbl');
		var minHeight = 320;
		if (table.length) {
			var bottomPadding = parseFloat(jQuery('#epgcard > .body').css('padding-bottom')) || 0;
			minHeight = table[0].getBoundingClientRect().top - cardTop + 140 + bottomPadding;
		}
		card.height(Math.max(window.innerHeight - cardTop - 20, minHeight));
	}

	function initShell() {
		resizeModernEpgCard();
		jQuery(function() {
			load_tvcontent_spin('ajax/multiepg?epgmode=tv');
		});
		jQuery.AdminBSB.input.activate();
	}

	function startEpgNowMarker(marker, update) {
		if (!marker.length) return;
		var node = marker[0];
		var interval;
		var observer = new MutationObserver(function() {
			if (!jQuery.contains(document, node)) stop();
		});
		function stop() {
			clearInterval(interval);
			observer.disconnect();
			jQuery(window).off('resize.epgNowMarker', update).off('pagehide.epgNowMarker', onPageHide);
		}
		function onPageHide(event) {
			stop();
			if (event.originalEvent && event.originalEvent.persisted) {
				jQuery(window).one('pageshow.epgNowMarker', function() {
					if (jQuery.contains(document, node)) startEpgNowMarker(marker, update);
				});
			}
		}
		update();
		interval = setInterval(function() {
			if (!jQuery.contains(document, node)) {
				stop();
				return;
			}
			update();
		}, 10000);
		observer.observe(document.body, {childList: true, subtree: true});
		jQuery(window).on('resize.epgNowMarker', update).on('pagehide.epgNowMarker', onPageHide);
		return stop;
	}

	function epgKeepVisibleShift(start, end, size, edge) {
		return Math.max(0, Math.min(edge - start, end - start - size));
	}

	function init(config) {
		if (disposeCurrent) disposeCurrent();
		var scope = jQuery('#modern-epg');
		var tableNode = document.getElementById('fulltbl');
		if (!scope.length || !tableNode) return;
		var disposed = false;
		var stopMarker;
		var pending = false;
		var frame;
		var jumpTimeout;
		var visibleTimeout;
		var observer = new MutationObserver(function() {
			if (!jQuery.contains(document, tableNode)) dispose();
		});
		function alive() {
			return !disposed && document.getElementById('fulltbl') === tableNode;
		}
		function dispose() {
			disposed = true;
			if (stopMarker) stopMarker();
			clearTimeout(jumpTimeout);
			clearTimeout(visibleTimeout);
			cancelAnimationFrame(frame);
			observer.disconnect();
			tableNode.removeEventListener('scroll', schedule);
			jQuery(window).off('.epgTable .epgKeepVisible .epgNowMarker');
			jQuery(document).off('.epgCalendar');
			if (disposeCurrent === dispose) disposeCurrent = null;
		}
		disposeCurrent = dispose;
		observer.observe(document.body, {childList: true, subtree: true});
		reloadTimers = false;

		function epgTimelineNowPosition() {
			return EpgTime.timelinePosition(EpgTime.now(), config.first);
		}

		function clampTimelineScroll(left) {
			return Math.max(0, Math.min(left, tableNode.scrollWidth - tableNode.clientWidth));
		}

		function updateEpgDateRange() {
			if (!alive()) return;
			var container = tableNode;
			var label = document.getElementById('epg-date-range');
			if (!container || !label) return;
			var bounds = container.getBoundingClientRect();
			var dates = {};
			function addDate(timestamp) {
				if (!isFinite(timestamp)) return;
				var date = EpgTime.dateAt(timestamp);
				if (isNaN(date.getTime())) return;
				dates[EpgTime.dateKey(date)] = date;
			}
			function visible(rect) {
				return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right;
			}
			if (container.classList.contains('epg__tv-guide')) {
				var slotStart = Number(container.getAttribute('data-slot-start'));
				container.querySelectorAll('#tbl1body tr').forEach(function(row, index) {
					var rect = row.getBoundingClientRect();
					if (!visible(rect)) return;
					// Use the row's two-hour slot even when its channel has no EPG events.
					var startFraction = Math.max(0, (bounds.top - rect.top) / (rect.bottom - rect.top));
					var endFraction = Math.min(1, (bounds.bottom - rect.top) / (rect.bottom - rect.top));
					addDate(EpgTime.slotTime(slotStart, index, startFraction));
					addDate(EpgTime.slotTime(slotStart, index, endFraction) - 1);
				});
				container.querySelectorAll('.epg__event[data-begin]').forEach(function(event) {
					if (visible(event.getBoundingClientRect())) addDate(Number(event.getAttribute('data-begin')));
				});
			} else {
				var first = Number(container.getAttribute('data-first'));
				var range = EpgTime.timelineWindow(first, container.scrollLeft, container.clientWidth,
					Number(container.getAttribute('data-timeline-end')));
				if (range) {
					var start = range.start;
					addDate(start);
					addDate(range.end);
					container.querySelectorAll('.epg__timeline-row').forEach(function(row) {
						if (!visible(row.getBoundingClientRect())) return;
						row.querySelectorAll('.eventlist .event[data-begin]').forEach(function(event) {
							var begin = Number(event.getAttribute('data-begin'));
							if (begin < start && Number(event.getAttribute('data-end')) > start && visible(event.getBoundingClientRect())) addDate(begin);
						});
					});
				}
			}
			var days = Object.keys(dates).map(function(key) { return dates[key]; }).sort(function(a, b) { return a - b; });
			if (!days.length) days = [EpgTime.dateAt(config.slotStart)];
			label.textContent = days.map(function(date) {
				return EpgTime.formatDate(date, config.dateLabels);
			}).join(' / ');
		}

		function layoutTvGuide() {
			if (!tableNode.classList.contains('epg__tv-guide')) return;
			tableNode.querySelectorAll('.epg__slot').forEach(function(surface) {
				var slotOffset = Number(surface.getAttribute('data-slot')) * 480;
				surface.querySelectorAll('.epg__event[data-begin][data-end]').forEach(function(event) {
					var interval = EpgTime.interval(Number(event.getAttribute('data-begin')), Number(event.getAttribute('data-end')),
						config.slotStart, config.slotStart + 86400, EpgTime.guideSecondsPerPixel);
					event.style.display = interval ? '' : 'none';
					if (!interval) return;
					event.style.top = interval.offset - slotOffset + 'px';
					event.style.height = interval.length + 'px';
				});
			});
		}
		layoutTvGuide();

		function updateKeepVisible() {
			pending = false;
			if (!alive()) return;
			var container = tableNode;
			var bounds = container.getBoundingClientRect();
			if (container.classList.contains('epg__tv-guide')) {
				var header = container.querySelector('.serviceheader');
				var edge = bounds.top + (header ? header.offsetHeight : 0);
				container.querySelectorAll('.epg__event[data-begin]').forEach(function(event) {
					var eventBounds = event.getBoundingClientRect();
					if (eventBounds.bottom <= edge || eventBounds.top >= bounds.bottom || eventBounds.right <= bounds.left || eventBounds.left >= bounds.right) return;
					var info = event.querySelector('.epg__event-info');
					var start = info.getBoundingClientRect().top - (info._epgShift || 0);
					var shift = epgKeepVisibleShift(start, eventBounds.bottom, info.offsetHeight, edge);
					info.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
					info._epgShift = shift;
				});
			} else {
				var channel = container.querySelector('.epg__channel-col');
				var edge = bounds.left + (channel ? channel.offsetWidth : 0);
				container.querySelectorAll('.epg__timeline-row').forEach(function(row) {
					var rowBounds = row.getBoundingClientRect();
					if (rowBounds.bottom <= bounds.top || rowBounds.top >= bounds.bottom) return;
					row.querySelectorAll('.eventlist .event[data-begin]').forEach(function(event) {
						var eventBounds = event.getBoundingClientRect();
						if (eventBounds.right <= edge || eventBounds.left >= bounds.right) return;
						var info = event.querySelector('.epg__timeline-info');
						var start = info.getBoundingClientRect().left - (info._epgShift || 0);
						var shift = epgKeepVisibleShift(start, eventBounds.right, info.offsetWidth, edge);
						info.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
						info._epgShift = shift;
					});
				});
			}
		}
		function schedule() {
			if (!pending && alive()) {
				pending = true;
				frame = requestAnimationFrame(updateKeepVisible);
			}
		}
		tableNode.addEventListener('scroll', schedule);
		jQuery(window).off('resize.epgKeepVisible').on('resize.epgKeepVisible', schedule);
		schedule();
		visibleTimeout = setTimeout(schedule, 150);

		function fixTableHeight() {
			var table = jQuery('#fulltbl');
			var card = jQuery('#epgcard');
			if (!table.length || !card.length) return;
			resizeModernEpgCard();
			var body = jQuery('#epgcard > .body');
			var bottomPadding = parseFloat(body.css('padding-bottom')) || 0;
			table.height(Math.max(140, card[0].getBoundingClientRect().bottom - table[0].getBoundingClientRect().top - bottomPadding));
			table.width(body.width());
		}
		fixTableHeight();
		updateEpgDateRange();
		jQuery('#fulltbl').on('scroll', updateEpgDateRange);
		jQuery(window).off('resize.epgTable').on('resize.epgTable', function(){ fixTableHeight(); updateEpgDateRange(); });

		function updateTvGuideNowMarker() {
			var marker = scope.find('.epg__tv-guide-now');
			var rows = jQuery('#tbl1body tr');
			var slot = EpgTime.slot(EpgTime.now(), config.slotStart);
			if (slot.index < 0 || slot.index >= rows.length) {
				marker.hide();
				return;
			}
			var container = jQuery('#fulltbl');
			var origin = jQuery('#tbl1body .epg__slot').first();
			if (!origin.length) {
				marker.hide();
				return;
			}
			var top = origin.offset().top - container.offset().top + container.scrollTop() + EpgTime.guidePosition(EpgTime.now(), config.slotStart);
			marker.css({top: top + 'px', width: jQuery('#tbl1').outerWidth() + 'px'}).show();
		}
		if (config.day === 0 && config.week === 0) {
			if (config.mode === 1) {
				stopMarker = startEpgNowMarker(scope.find('.epg__tv-guide-now'), updateTvGuideNowMarker);
			} else {
				var marker = scope.find('.timetable-now');
				var inner = scope.find('#tblinner');
				stopMarker = startEpgNowMarker(marker, function() {
					var now = EpgTime.now();
					if (now < config.first || now >= config.timelineEnd) {
						marker.hide();
						return;
					}
					marker.css({left: epgTimelineNowPosition() + 'px', height: inner.height()}).show();
				});
			}
		} else {
			scope.find('.timetable-now').css('height', '0').hide();
		}

		var list = document.getElementById('bqlist');
		var wrap = document.getElementById('bqwrap');
		function updateBouquetHint() {
			wrap.classList.toggle('at-end', list.scrollLeft + list.clientWidth >= list.scrollWidth - 2);
		}
		list.addEventListener('scroll', updateBouquetHint);
		updateBouquetHint();
		scope.find('.bq').click(function() {
			var id = jQuery(this).data('ref');
			jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + id + '&day=' + config.day + '&epgmode=' + config.epgmode);
			SetLSValue('lastmbq_' + config.epgmode, id);
		});

		(function() {
			var toggle = jQuery('#epg-calendar-toggle');
			var popup = jQuery('#epg-calendar-popup');
			var nav = toggle.closest('.nav-tabs');
			var grid = jQuery('#epg-calendar-grid');
			var selected = EpgTime.dateAt(config.slotStart);
			var calendarYear = selected.getFullYear();
			var calendarMonth = selected.getMonth();
			var bouquet = toggle.attr('data-bref');
			var available = window.epgCalendarDaysCache || (window.epgCalendarDaysCache = {});
			var watched = {};
			function loadCalendarDays(year, month) {
				var key = JSON.stringify([bouquet, year, month]);
				var entry = available[key];
				if (!entry) entry = available[key] = {days: null, updated: 0, request: null};
				if (!entry.request && (!entry.days || Date.now() - entry.updated >= 60000)) {
					entry.request = jQuery.getJSON('api/epgcalendar?bref=' + encodeURIComponent(bouquet) + '&year=' + year + '&month=' + (month + 1))
						.done(function(data) {
							if (data.result) {
								entry.days = new Set(data.days);
								entry.updated = Date.now();
							}
						}).always(function() { entry.request = null; });
				}
				if (entry.request && watched[key] !== entry.request) {
					watched[key] = entry.request;
					entry.request.done(function(data) {
						if (data.result && alive() && popup.is(':visible') && year === calendarYear && month === calendarMonth) renderCalendar();
					});
				}
				return entry.days;
			}
			function renderCalendar() {
				var year = calendarYear;
				var month = calendarMonth;
				var days = loadCalendarDays(year, month);
				jQuery('#epg-calendar-month').text(new Date(year, month, 1).toLocaleDateString(undefined, {month: 'long', year: 'numeric'}));
				grid.find('button, .epg-calendar__blank').remove();
				var blanks = (new Date(year, month, 1).getDay() + 6) % 7;
				for (var gap = 0; gap < blanks; gap++) grid.append('<span class="epg-calendar__blank"></span>');
				var count = new Date(year, month + 1, 0).getDate();
				for (var number = 1; number <= count; number++) {
					var date = new Date(year, month, number);
					var button = jQuery('<button type="button"></button>').text(number).attr('title', date.toLocaleDateString()).data('date', date);
					button.toggleClass('has-epg', !!(days && days.has(EpgTime.dateKey(date))));
					button.toggleClass('is-selected', EpgTime.dayOffset(date, selected) === 0);
					grid.append(button);
				}
			}
			toggle.on('click', function(event) {
				event.stopPropagation();
				popup.toggle();
				nav.toggleClass('epg-calendar-open', popup.is(':visible'));
				toggle.attr('aria-expanded', popup.is(':visible') ? 'true' : 'false');
				if (popup.is(':visible')) renderCalendar();
			});
			jQuery('#epg-calendar-prev, #epg-calendar-next').on('click', function() {
				var change = this.id === 'epg-calendar-next' ? 1 : -1;
				var month = new Date(calendarYear, calendarMonth + change, 1);
				calendarYear = month.getFullYear();
				calendarMonth = month.getMonth();
				renderCalendar();
			});
			grid.on('click', 'button', function() {
				var date = jQuery(this).data('date');
				jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + encodeURIComponent(bouquet) + '&day=' + EpgTime.dayOffset(date, new Date()) + '&epgmode=' + config.epgmode + '&week=0');
			});
			jQuery(document).off('click.epgCalendar keydown.epgCalendar').on('click.epgCalendar', function(event) {
				if (!jQuery(event.target).closest('#epg-calendar-wrap').length) {
					popup.hide();
					nav.removeClass('epg-calendar-open');
					toggle.attr('aria-expanded', 'false');
				}
			}).on('keydown.epgCalendar', function(event) {
				if (event.key === 'Escape') {
					popup.hide();
					nav.removeClass('epg-calendar-open');
					toggle.attr('aria-expanded', 'false').trigger('focus');
				}
			});
			loadCalendarDays(calendarYear, calendarMonth);
		})();

		if (config.mode === 1) {
			scope.find('.service').click(function() {
				var ref = jQuery(this).data('ref');
				if (ref != undefined) zapChannel(ref, '');
			});
		} else {
			scope.find('.epg__channel-col').click(function() {
				var ref = jQuery(this).closest('.epg__timeline-row').data('ref');
				if (ref != undefined) zapChannel(ref, '');
			});
		}
		scope.find('.plusclick').click(function() {
			var day = jQuery(this).data('day');
			var epgmode = config.epgmode;
			if (day != undefined) {
				if (day > 999) {
					var w = day - 1000;
					jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + config.day + '&epgmode=' + epgmode + '&week=' + w);
				} else if (day > 199) {
					var d = day - 200;
					var targetTime = d == 0 ? EpgTime.now() : Number(jQuery(this).data('time'));
					if (config.mode === 1) {
						var slot = EpgTime.slot(targetTime, config.slotStart);
						var rows = jQuery('#tbl1body tr');
						if (slot.index >= 0 && slot.index < rows.length) {
							var container = jQuery('#fulltbl');
							var origin = jQuery('#tbl1body .epg__slot').first();
							if (!origin.length) return;
							var headerHeight = jQuery('.serviceheader').first().outerHeight() || 0;
							var top = origin.offset().top - container.offset().top + container.scrollTop() + EpgTime.guidePosition(targetTime, config.slotStart) - headerHeight;
							container.animate({scrollTop: Math.max(0, top)}, 500);
						} else if (slot.index < 0) {
							jQuery('#fulltbl').animate({scrollTop: 0}, 500);
						}
					} else {
						var pos = EpgTime.timelinePosition(targetTime, config.first);
						jQuery('#fulltbl').animate({scrollLeft: clampTimelineScroll(pos - 160)}, 500);
					}
				} else if (day > 100) {
					var mode = day - 100;
					if (mode != config.mode) {
						jQuery.ajax({
							url: 'api/setwebconfig?mepgmode=' + mode,
							success: function(data) {
								if (alive()) jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + config.day + '&epgmode=' + epgmode + '&week=' + config.week);
							}
						});
					}
				} else {
					jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?bref=' + config.bref + '&day=' + day + '&epgmode=' + epgmode + '&week=' + config.week);
				}
			} else {
				var epgmode = jQuery(this).data('tvradio');
				if (epgmode != undefined) jQuery('#tvcontent').html(loadspinner).load('ajax/multiepg?day=' + config.day + '&epgmode=' + epgmode);
			}
		});

		if (jQuery('#header').is(':hidden')) {
			jQuery('#compressmepg').show();
			jQuery('#refreshmepg2').show();
		}
		if (mepgdirect == 1) {
			mepgdirect = 0;
			jQuery('#expandmepg').click();
		}

		var epgJumpNow = config.jumpNow;
		var epgJumpActiveService = config.jumpActiveService;
		var currentServiceRef = config.currentServiceRef;
		function autoJumpTvGuide() {
			if (epgJumpActiveService && currentServiceRef) {
				var normActive = currentServiceRef.trim().toLowerCase().replace(/%3a/g, ':');
				var targetCol = null;
				jQuery('#tbl2body td.serviceheader, .serviceheader').each(function() {
					var sref = (jQuery(this).data('sref') || jQuery(this).data('ref') || jQuery(this).attr('data-sref') || jQuery(this).attr('data-ref') || '').toString().trim().toLowerCase().replace(/%3a/g, ':');
					if (sref && (sref === normActive || normActive.indexOf(sref) === 0 || sref.indexOf(normActive) === 0)) {
						targetCol = jQuery(this);
						return false;
					}
				});
				if (targetCol && targetCol.length) {
					var scroller = jQuery('#fulltbl');
					var colPos = targetCol.position();
					if (colPos) {
						var targetX = scroller.scrollLeft() + colPos.left - (scroller.width() / 2) + (targetCol.outerWidth() / 2);
						scroller.scrollLeft(Math.max(0, targetX));
					}
				}
			}
			if (config.day === 0 && epgJumpNow) {
				var container = jQuery('#fulltbl');
				if (container.length) {
					var containerTop = container.offset().top;
					var containerScroll = container.scrollTop();
					var headerHeight = jQuery('.serviceheader').first().outerHeight() || 0;
					var slot = EpgTime.slot(EpgTime.now(), config.slotStart);
					if (slot.index >= 0 && slot.index < 12) {
						var origin = jQuery('#tbl1body .epg__slot').first();
						if (origin.length) {
							var targetY = origin.offset().top - containerTop + containerScroll + EpgTime.guidePosition(EpgTime.now(), config.slotStart) - headerHeight - (container.height() - headerHeight) * 0.3;
							container.scrollTop(Math.max(0, targetY));
						}
					}
				}
			}
		}
		function autoJumpTimeline() {
			var targetRow = null;
			if (epgJumpActiveService && currentServiceRef) {
				var normActive = currentServiceRef.trim().toLowerCase().replace(/%3a/g, ':');
				jQuery('.epg__row').each(function() {
					var sref = (jQuery(this).data('sref') || jQuery(this).data('ref') || jQuery(this).attr('data-sref') || jQuery(this).attr('data-ref') || '').toString().trim().toLowerCase().replace(/%3a/g, ':');
					if (sref && (sref === normActive || normActive.indexOf(sref) === 0 || sref.indexOf(normActive) === 0)) {
						targetRow = jQuery(this);
						return false;
					}
				});
				if (targetRow && targetRow.length) {
					var container = jQuery('#fulltbl');
					var rowPos = targetRow.position();
					if (rowPos) {
						var targetY = container.scrollTop() + rowPos.top - (container.height() / 2) + (targetRow.outerHeight() / 2);
						container.scrollTop(Math.max(0, targetY));
					}
				}
			}
			if (config.day === 0 && epgJumpNow) {
				var container = jQuery('#fulltbl');
				var markerLeft = epgTimelineNowPosition();
				if (!isNaN(markerLeft)) {
					var channelWidth = jQuery('.epg__channel-col').first().outerWidth() || 0;
					container.scrollLeft(clampTimelineScroll(markerLeft - channelWidth - (container.width() - channelWidth) * 0.3));
				}
			}
		}
		jumpTimeout = setTimeout(function() {
			if (!alive()) return;
			if (config.mode === 1) autoJumpTvGuide();
			else autoJumpTimeline();
			updateEpgDateRange();
		}, 100);
	}
	root.ModernEpg = {init: init, initShell: initShell};
})(window);
