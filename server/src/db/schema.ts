import { pgTable, uuid, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

// Every player — guest by default
// id = localStorage UUID sent from client, this IS the identity
export const users = pgTable('users', {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    isGuest: boolean('is_guest').default(true),
    username: text('username'),             // null until they claim account later
    createdAt: timestamp('created_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
});

// One record per game
export const matches = pgTable('matches', {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: text('room_id').notNull(),
    watchCode: text('watch_code').notNull().unique(), // shareable replay link code
    gameType: text('game_type').notNull(),            // 'classic' | 'points'
    gameMode: text('game_mode').notNull(),            // 'friendly' | 'challenge'
    status: text('status').notNull().default('active'), // 'active' | 'paused' | 'completed'
    winnerColor: text('winner_color'),               // 'white' | 'black' | 'draw' | null
    finalFen: text('final_fen'),
    startedAt: timestamp('started_at').defaultNow(),
    endedAt: timestamp('ended_at'),
    isStarred: boolean('is_starred').default(false),
});

// Bridge table — connects 2 players to 1 match
// Reason: a match has 2 users, storing userId inside matches would mean 2 columns
// This way its clean — query all matches for a user with one join
export const userMatches = pgTable('user_matches', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    matchId: uuid('match_id').references(() => matches.id),
    color: text('color').notNull(),                  // 'white' | 'black'
    pointsScored: integer('points_scored').default(0), // for points mode later
});

// Every move of every game — all in one table, filtered by matchId
// Written async on every move so game can be recovered if server crashes
// Moves for unstarred games deleted after 30 days by cleanup cron job
export const matchMoves = pgTable('match_moves', {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id').references(() => matches.id),
    moveNumber: integer('move_number').notNull(),    // 1=white first, 2=black first, alternating
    from: text('from').notNull(),                    // 'e2'
    to: text('to').notNull(),                        // 'e4'
    piece: text('piece').notNull(),                  // 'p', 'n', 'b', 'r', 'q', 'k'
    capturedPiece: text('captured_piece'),           // null if no capture
    fenAfter: text('fen_after').notNull(),           // full board state after this move
    pointsAwarded: integer('points_awarded').default(0), // for points mode later
    playedAt: timestamp('played_at').defaultNow(),
});