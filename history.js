// 75 lines to not overlap the html file













// 60 lines to not overlap the html file














// 45 lines to not overlap the html file














// 30 lines to not overlap the html file














// 15 lines to not overlap the html file














myUserId = 0
my_tournaments = []
active_players = []
my_pid_by_organizer = {}
all_data = {
	player: {},
	arena: {},
	tournament: {},
	game: {}
}

log('history begin')

async function get(options) {
	let headers = {}
	headers['Authorization'] = `Bearer ${token}`
	headers['Content-Type'] = 'application/json'
	headers['Accept'] = 'application/json'

	let request = {}
	request.headers = headers
	let base_url = 'https://app.matchplay.events/api/'
	request.url = base_url + options.endpoint
	if (options.query) {
		request.url += '?' + $.param(options.query)
	}
	request.dataType = 'json'
	log(request.url)
	let requested = $.get(request)
	requested.fail(function (e) {
		log('error:')
		log(e.toString())
		throw e
	})
	response = await requested
	return response.data
};

async function get_me() {
	let data = await get({
		endpoint: 'users/profile'
	})
	myUserId = data.userId
}

async function get_my_tournaments() {
	return await get_tournaments(myUserId)
}

async function get_tournaments(uid) {
	let data = await get({
		endpoint: 'tournaments',
		query: {played: uid}
	})
	data.forEach(function (tournament) {
		save_data('tournament', tournament)
	})
	return data
}
async function get_games_from_tournament(tournament) {
	let tid = tournament.tournamentId
	let pid
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid]
		log(`already knew my pid: ${pid}`)
	} else {
		pid = await get_tournament_details(tournament)
		log(`my pid: ${pid}`)
		my_pid_by_organizer[tid] = pid
	}
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	})
	log('got games')
	games.forEach(function (game) {
		game.userIds.forEach(function (uid) {
			if (uid == myUserId) return
			if (active_players[uid]) {
				save_data('game', game)
			}
		})
	})
	return games
}
async function get_tournament_details(tournament) {
	let tid = tournament.tournamentId
	log(`getting tournament ${tid} details`)
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	})
	let pid
	// log(tournament_details)
	log('adding players')
	tournament_details.players.forEach(function (player) {
		let uid = player.claimedBy
		if (uid == myUserId) {
			pid = player.playerId
		}
		if (!all_data.player[uid]) {
			all_data.player[uid] = player
			add_player_button(uid)
		}
	})
	log('adding arenas')
	tournament_details.arenas.forEach(function (arena) {
		save_data('arena', arena)
	})
	return pid
}
async function get_other() {
	let tournament = my_tournaments[0]
	let active_games = await get_games_from_tournament(tournament)
	active_games.reverse()
	$('#active-tournament-title').append(title('tournament', tournament))
	let newest = true
	active_games.forEach(function (game) {
		if (newest) {
			game.userIds.forEach((uid) => {
				if (uid == myUserId) return
				active_players.push(uid)
			})
		}
		add_active_game(game, newest)
		newest = false
	})
}
async function merge_tournaments() {
	active_players.forEach(function (uid) {

	})
}
function premain() {
    token = localStorage.getItem('token')
	if (!token) {
	$('#token-entry').show()
		$('#token-form').on('submit', async function (event) {
			event.preventDefault()
			token = $('#token').val()
			localStorage.setItem('token', token)
			main().catch(log)
		})
	} else {
		$('#token-entry').hide()
		main().catch(log)
	}
}
async function main() {
	await get_me()
	my_tournaments = await get_my_tournaments()
	await get_other()
	await merge_tournaments()
	//todo.push(merge_tournaments)
	//todo.push(get_games_from_tournaments)
	//todo.push(get_missing_tournament_details)
}

////////////////////////////////////////////////////////////////

$(function() {
	try {
		premain()
	} catch (err) {
		log(err)
	}
	$('#players').on('click', '.player.button', function () {
		let uid = $(this).data('userId')
		alert(`player ${uid} clicked`)
	})
});

function insertSorted(element, parent) {
	let added = false
	let etext = element.text().toLowerCase()
	parent.children().each(function(){
		if (($(this).text().toLowerCase()) > etext) {  // }.localeCompare(etext, 'en', {'sensitivity': 'base'})) {
			element.insertBefore($(this))
			added = true;
			return false;
		}
	});
	if(!added) element.appendTo(parent)
}

function add_player_button(uid) {
	let button = title('player', uid).addClass('box button')
	insertSorted(button, $('#players'))
}

function title(kind, id) {
	let element = $('<span>')
	element.addClass(kind+'-name').data('id', id)
	let name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id)
	if (kind == 'player' && id == myUserId) {
		name = 'Me'
	}
	element.text(name)
	return element
}
function save_data(kind, obj) {
	let id = obj[kind+'Id']
	all_data[kind][id] = obj
	$(`.${kind}-title[data-id="${id}"`).text(obj.name)
}
function spacer() {
	return $('<div>').addClass('spacer')
}
function add_active_game(game, active) {
	log(game)
	let box = $('<div>').addClass('game box')
	if (active) {
		box.addClass('active')
	}
	title('arena', game.arenaId).appendTo(box)
	spacer().appendTo(box)
	title('tournament', game.tournamentId).appendTo(box)
	spacer().appendTo(box)
	let plist = $('<ol>').addClass('players').appendTo(box)
	game.userIds.forEach(function (uid) {
		$('<li>').append(title('player', uid)).appendTo(plist)
	})
	$('#active-games').append(box)
}

log('history end')
