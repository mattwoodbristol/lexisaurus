-- Where a review answer came from: 'practise' when answered from Grammar of the day's Practise,
-- which is what ticks it (a grammar card met in the day's reviews does not). NULL otherwise.
ALTER TABLE reviews ADD COLUMN via TEXT;
