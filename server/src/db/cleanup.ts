import cron from 'node-cron';
import { db } from './postgres';
import { matches, matchMoves } from './schema';
import { eq, and, lt, inArray, isNotNull } from 'drizzle-orm';

export function startCleanupJob() {
    // Runs every day at 12am — '0 0 * * *'
    cron.schedule('0 0 * * *', async () => {
        console.log('[Cleanup] 12am job started');

        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Find all unstarred completed matches older than 30 days
            const expiredMatches = await db
                .select({ id: matches.id, roomId: matches.roomId })
                .from(matches)
                .where(
                    and(
                        eq(matches.isStarred, false),           // not starred
                        eq(matches.status, 'completed'),        // game finished
                        isNotNull(matches.endedAt),             // has an end date
                        lt(matches.endedAt, thirtyDaysAgo)      // ended more than 30 days ago
                    )
                );

            if (expiredMatches.length === 0) {
                console.log('[Cleanup] No expired matches found, all clean');
                return;
            }

            const expiredMatchIds = expiredMatches.map(m => m.id);

            // Delete their moves from match_moves
            // match record itself stays — keeps the result, date, players
            // just the move detail is gone
            const deleted = await db
                .delete(matchMoves)
                .where(inArray(matchMoves.matchId, expiredMatchIds));

            console.log(`[Cleanup] Deleted moves for ${expiredMatches.length} expired matches`);
            console.log(`[Cleanup] Affected rooms: ${expiredMatches.map(m => m.roomId).join(', ')}`);

        } catch (err) {
            console.error('[Cleanup] Job failed:', err);
        }
    });

    console.log('[Cleanup] 12am cleanup job scheduled');
}