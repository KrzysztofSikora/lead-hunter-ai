/** One entry of a feed, mapped to the fields of a raw signal (S-10 Design). */
export interface FeedItem {
  /** `guid`/`id`, else the link: the item's identity inside its source (D-3, D-4). */
  key: string | null;
  url: string | null;
  title: string;
  text: string;
  publishedAt: number | null;
}
