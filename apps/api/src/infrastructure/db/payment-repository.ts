import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { PaymentRepository } from '../../modules/opportunities/ports.js';
import { opportunities, payments } from './schema.js';

export function createPaymentRepository(db: BetterSQLite3Database): PaymentRepository {
  return {
    add(id, payment, at) {
      return db.transaction((tx) => {
        const exists = tx
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(eq(opportunities.id, id))
          .get();
        if (!exists) return false;
        tx.insert(payments)
          .values({ opportunityId: id, ...payment, createdAt: at })
          .run();
        return true;
      });
    },
  };
}
