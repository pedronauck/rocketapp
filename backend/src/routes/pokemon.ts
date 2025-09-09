import type { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { getDatabase } from '../db/database';
import { log } from '../utils/log';

// Validation schemas
const PaginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

export function registerPokemonRoutes(app: Hono) {
  const db = getDatabase();

  // Get user's Pokemon queries
  app.get('/api/pokemon-queries', authMiddleware, async (c) => {
    try {
      const user = c.get('user');
      const query = c.req.query();
      
      const parsed = PaginationSchema.safeParse(query);
      if (!parsed.success) {
        return c.json({ 
          error: 'ValidationError', 
          message: 'Invalid pagination parameters' 
        }, 400);
      }
      
      const { limit, offset } = parsed.data;
      const result = await db.getPokemonQueries(user.phoneNumber, limit, offset);
      
      log.debug('[pokemon] Fetched queries', { 
        phoneNumber: user.phoneNumber,
        count: result.queries.length,
        total: result.total 
      });
      
      return c.json({
        queries: result.queries,
        pagination: {
          limit,
          offset,
          total: result.total,
          hasMore: offset + limit < result.total
        }
      });
    } catch (error) {
      log.error('[pokemon] Error fetching queries', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Failed to fetch Pokemon queries' 
      }, 500);
    }
  });

  // Get specific Pokemon query details
  app.get('/api/pokemon-queries/:callSid', authMiddleware, async (c) => {
    try {
      const user = c.get('user');
      const callSid = c.req.param('callSid');
      
      // Get conversation details
      const conversation = await db.getConversationBySid(callSid);
      
      if (!conversation) {
        return c.json({ 
          error: 'NotFound', 
          message: 'Query not found' 
        }, 404);
      }
      
      // Verify ownership
      if (conversation.phone_number !== user.phoneNumber) {
        return c.json({ 
          error: 'Forbidden', 
          message: 'Access denied' 
        }, 403);
      }
      
      // Parse messages for detailed view
      let messages = [];
      let pokemonMentioned = new Set<string>();
      
      try {
        const parsedMessages = JSON.parse(conversation.messages);
        messages = parsedMessages;
        
        // Extract all Pokemon mentioned
        for (const msg of parsedMessages) {
          const pokemonPattern = /\b(Pikachu|Charizard|Bulbasaur|Squirtle|Charmander|Wartortle|Blastoise|Caterpie|Metapod|Butterfree|Weedle|Kakuna|Beedrill|Pidgey|Pidgeotto|Pidgeot|Rattata|Raticate|Spearow|Fearow|Ekans|Arbok|Sandshrew|Sandslash|Nidoran|Nidorina|Nidoqueen|Nidorino|Nidoking|Clefairy|Clefable|Vulpix|Ninetales|Jigglypuff|Wigglytuff|Zubat|Golbat|Oddish|Gloom|Vileplume|Paras|Parasect|Venonat|Venomoth|Diglett|Dugtrio|Meowth|Persian|Psyduck|Golduck|Mankey|Primeape|Growlithe|Arcanine|Poliwag|Poliwhirl|Poliwrath|Abra|Kadabra|Alakazam|Machop|Machoke|Machamp|Bellsprout|Weepinbell|Victreebel|Tentacool|Tentacruel|Geodude|Graveler|Golem|Ponyta|Rapidash|Slowpoke|Slowbro|Magnemite|Magneton|Farfetch|Doduo|Dodrio|Seel|Dewgong|Grimer|Muk|Shellder|Cloyster|Gastly|Haunter|Gengar|Onix|Drowzee|Hypno|Krabby|Kingler|Voltorb|Electrode|Exeggcute|Exeggutor|Cubone|Marowak|Hitmonlee|Hitmonchan|Lickitung|Koffing|Weezing|Rhyhorn|Rhydon|Chansey|Tangela|Kangaskhan|Horsea|Seadra|Goldeen|Seaking|Staryu|Starmie|Scyther|Jynx|Electabuzz|Magmar|Pinsir|Tauros|Magikarp|Gyarados|Lapras|Ditto|Eevee|Vaporeon|Jolteon|Flareon|Porygon|Omanyte|Omastar|Kabuto|Kabutops|Aerodactyl|Snorlax|Articuno|Zapdos|Moltres|Dratini|Dragonair|Dragonite|Mewtwo|Mew)\b/gi;
          const matches = msg.content.match(pokemonPattern);
          if (matches) {
            matches.forEach(match => pokemonMentioned.add(match));
          }
        }
      } catch (err) {
        log.error('[pokemon] Error parsing conversation messages', { err });
      }
      
      return c.json({
        callSid: conversation.call_sid,
        timestamp: conversation.started_at,
        duration: conversation.ended_at && conversation.started_at 
          ? conversation.ended_at - conversation.started_at 
          : undefined,
        pokemonMentioned: Array.from(pokemonMentioned),
        messages: messages,
        messageCount: messages.length
      });
    } catch (error) {
      log.error('[pokemon] Error fetching query details', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Failed to fetch query details' 
      }, 500);
    }
  });

  // Get user's Pokemon statistics
  app.get('/api/pokemon-queries/stats', authMiddleware, async (c) => {
    try {
      const user = c.get('user');
      
      // Get all queries to calculate stats
      const result = await db.getPokemonQueries(user.phoneNumber, 1000, 0);
      
      // Calculate statistics
      const allPokemon = new Map<string, number>();
      let totalDuration = 0;
      let callCount = result.queries.length;
      
      for (const query of result.queries) {
        // Count Pokemon occurrences
        for (const pokemon of query.pokemon_names) {
          allPokemon.set(pokemon, (allPokemon.get(pokemon) || 0) + 1);
        }
        
        // Sum durations
        if (query.duration) {
          totalDuration += query.duration;
        }
      }
      
      // Sort Pokemon by frequency
      const topPokemon = Array.from(allPokemon.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));
      
      // Get recent activity
      const recentQueries = result.queries.slice(0, 5);
      
      return c.json({
        stats: {
          totalCalls: callCount,
          uniquePokemon: allPokemon.size,
          totalDuration: totalDuration,
          averageDuration: callCount > 0 ? Math.round(totalDuration / callCount) : 0,
          topPokemon,
          recentActivity: recentQueries.map(q => ({
            callSid: q.call_sid,
            timestamp: q.timestamp,
            pokemonCount: q.pokemon_names.length
          }))
        }
      });
    } catch (error) {
      log.error('[pokemon] Error calculating stats', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Failed to calculate statistics' 
      }, 500);
    }
  });

  // Health check
  app.get('/api/pokemon/health', (c) => {
    return c.json({ 
      status: 'ok', 
      service: 'pokemon',
      timestamp: new Date().toISOString()
    });
  });
}