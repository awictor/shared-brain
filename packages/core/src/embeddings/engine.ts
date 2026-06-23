import { pipeline, env } from '@xenova/transformers';

// Configure model caching
env.allowRemoteModels = true;
env.cacheDir = './models';

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline>>;

/**
 * Local embedding engine using Xenova/all-MiniLM-L6-v2 via ONNX Runtime.
 * Produces 384-dimensional normalized embeddings without any external API calls.
 */
export class EmbeddingEngine {
  private extractor: FeatureExtractionPipeline | null = null;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';
  private readonly dimensions = 384;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the embedding model. Downloads on first use, cached thereafter.
   * Safe to call multiple times — will only initialize once.
   */
  async initialize(): Promise<void> {
    if (this.extractor) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.extractor = await pipeline('feature-extraction', this.modelName, {
        quantized: true,
      });
    })();

    return this.initPromise;
  }

  /**
   * Embed a single text string into a 384-dimensional vector.
   * The vector is normalized (unit length), so dot product = cosine similarity.
   */
  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error('EmbeddingEngine not initialized. Call initialize() first.');
    }

    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    return new Float32Array(output.data);
  }

  /**
   * Embed multiple texts in batches for efficiency.
   * Processes in batches of 32 to manage memory usage.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!this.extractor) {
      throw new Error('EmbeddingEngine not initialized. Call initialize() first.');
    }

    const results: Float32Array[] = [];
    const batchSize = 32;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const output = await this.extractor(batch, {
        pooling: 'mean',
        normalize: true,
      });

      // Handle both single and batch outputs
      if (batch.length === 1) {
        results.push(new Float32Array(output.data));
      } else {
        for (let j = 0; j < batch.length; j++) {
          const start = j * this.dimensions;
          const end = start + this.dimensions;
          results.push(new Float32Array(output.data.slice(start, end)));
        }
      }
    }

    return results;
  }

  /**
   * Get the dimensionality of the embedding vectors.
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Get the model name.
   */
  getModelName(): string {
    return this.modelName;
  }

  /**
   * Check if the engine is initialized.
   */
  isReady(): boolean {
    return this.extractor !== null;
  }
}
