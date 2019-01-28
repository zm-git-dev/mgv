/*
 * DataManager
 *
 * The thing the app talks to when it needs genomic data. It interacts with a
 * DataSource to get "raw" data from the server (or wherever). It processes the
 * responses (eg, registers features, builds indices, etc) and maintains them in a cache,
 *
 * FIXME: some methods return promises and some methods return data directly.
 * Should adopt a naming convention so that caller knows which, eg, getFoo vs getFooP
 * or getPfFoo (get promise for foo)
 */
import gc from '@/lib/GenomeCoordinates'
import u from '@/lib/utils'
import { SwimLaneAssigner, FeaturePacker, ContigAssigner } from '@/lib/Layout'
import config from '@/config'
import { GenomeRegistrar } from '@/lib/GenomeDataFetcher'
import gff3 from '@/lib/gff3lite'

class DataManager {
  constructor (proxy) {
    this.cache = {} // { genome.name -> { chr.name -> P([ feats ]) } }
    this.id2feat = {} // ID -> feature
    this.cid2feats = {} // cID -> [ features ]
    this.symbol2feats = {} // symbol -> [ features ]
    this.proxy = proxy // actual data source
    this.greg = new GenomeRegistrar()
    this.genomes = this.greg.register('.')
  }
  getFeatureById (id) {
    return this.id2feat[id]
  }
  getFeaturesByCid (cid) {
    return this.cid2feats[cid]
  }
  getFeaturesBySymbol (symbol) {
    return this.symbol2feats[symbol.toLowerCase()]
  }
  getFeaturesBy (val) {
    let f = this.getFeatureById(val)
    if (f) return [f]
    return this.getFeaturesByCid(val) || this.getFeaturesBySymbol(val) || []
  }
  // Returns a promise for all the genomes we know about.
  getGenomes () {
    return this.genomes.then(genomes => {
      genomes.forEach((g, i) => {
        g.height = 60
        g.zoomY = i * g.height
        g.dragY = 0
      })
      return genomes
    })
  }
  // Returns a promise that resolves when all features of genome g have been loaded and registered.
  // After resolution, one may access the features of chromosome c via this,cache[g.name][c.name]
  ensureFeatures (g) {
    //
    if (this.cache[g.name]) return Promise.resolve(true)
    //
    this.cache[g.name] = {}
    return this.greg.getReader(g, 'genes').readAll().then(recs => {
      let prevChr = null
      let feats = []
      let allFeats = []
      recs.forEach(r => {
        if (!prevChr || r[0] !== prevChr.name) {
          if (feats.length) {
            allFeats.push(this._registerChr(g, prevChr, feats))
          }
          prevChr = g.name2chr[r[0]]
          if (!prevChr) u.fail("Could not find chromosome " + r[0])
          feats = [r]
        }
        else {
          feats.push(r)
        }
      })
      if (feats.length) allFeats.push(this._registerChr(g, prevChr, feats))
      return allFeats
    })
  }
  //
  _registerChr (g, c, feats) {
    console.log('Registering', feats.length, 'features for', g.name, c.name)
    let freg = new FeatureRegistrar(g, c, this.id2feat, this.cid2feats, this.symbol2feats)
    let cfeats = feats.map(f => freg.register(f)).filter(x => x)
    this.cache[g.name][c.name] = cfeats
    return cfeats
  }
  // Returns a promise for all the feature of the specified genome, as a list, sorted by
  // chr and start position.
  getAllFeatures (g) {
    return this.ensureFeatures(g).then(() => this.getAllFeaturesNow(g))
  }
  // Immediate version of getAllFeatures. Returns whatever is in the cache
  getAllFeaturesNow (g) {
    return u.concatAll(g.chromosomes.map(c => this.cache[g.name][c.name]))
  }
  // Returns a promise for the transcripts and exons of features that overlap the specified range of the specified genome.
  _unpackExons (t) {
    const exonsAttr = t[8]['exons']
    const ecoords = exonsAttr.split(',').map(s => s.split('_').map(s => parseInt(s)))
    return ecoords.map(ec => { return { start: t[3] + ec[0], end: t[3] + ec[0] + ec[1] - 1 } })
  }
  // Returns a promise for the features in the specified range of the specified genome
  getGenes (g, c, s, e, includeTranscripts) {
    return this.ensureFeatures(g).then(() => {
      let feats = this.cache[g.name][c.name]
      feats = feats.filter(f => gc.overlaps(f, { chr: c, start: s, end: e }))
      if (includeTranscripts) {
        return this.getModels(g, c, s, e).then(tps => {
          const gid2tps = u.index(tps, t => t.gID, false)
          feats.forEach(f => {
            if (f.transcripts.length) return
            const ftps = gid2tps[f.ID] || []
            ftps.forEach(t => f.transcripts.push(t))
          })
          return feats
        })
      }
      return feats
    })
  }
  getModels (g, c, s, e) {
    return this.greg.getReader(g, 'transcripts').readRange(c, s, e).then(ts => {
      return ts.map(t => {
        return {
          gID: t[8]['Parent'],
          tID: t[8]['ID'],
          exons: this._unpackExons(t)
        }
      })
    })
  }
  // Returns a promise for the genomic sequence of the specified range for the specified genome
  getSequence (g, c, s, e) {
    return this.greg.getReader(g, 'sequences').readRange(c, s, e)
  }
  // Returns the genologs of feature f from the specified genomes in the specified order.
  // If a genolog does not exist in a given genome, that entry in the returned list === undefined.
  getGenologs (f, genomes) {
    let feats
    if (typeof f === 'string') {
      f = (this.getFeaturesBy(f) || [])[0]
    }
    if (!f) {
      return []
    }
    if (f.cID) {
      feats = this.cid2feats[f.cID]
    } else {
      feats = [f]
    }
    let fix = u.index(feats, f => f.genome.name)
    let genologs = genomes.map(g => fix[g.name])
    return genologs
  }
  // Returns the genolog of feature f from genome g, or undefined if none exists
  getGenolog (f, g) {
    return this.getGenologs(f, [g])[0]
  }
  //
  getQueries () {
    return this.proxy.getQueries()
  }
  //
  getFastaUrl (f, type, genomes) {
    return this.proxy.getFastaUrl(f, type, genomes)
  }
}

// Registers features for one chromsome of a genome
class FeatureRegistrar {
  constructor (g, c, id2f, cid2f, sym2f) {
    console.log('FeatureRegistrar', g.name, c.name)
    // each chromosome of each genome has its own registrar
    this.genome = g
    this.chr = c
    // swim lane assigner - plus strand
    this.slap = new SwimLaneAssigner()
    // swim lane assigner - minus strand
    this.slam = new SwimLaneAssigner()
    // feature packer
    this.fp = new FeaturePacker(0, 15000)
    // contig assigner
    this.ca = new ContigAssigner()
    // map feature.ID => feature
    this.id2feat = id2f
    // map feature.cID => [ features ]
    this.cid2feats = cid2f
    // map feature.symbol => [ features ]
    this.symbol2feats = sym2f
  }
  // Args:
  //   r - a parsed GFF3 record
  register (r) {
    const f = gff3.record2object(r)
    f.tCount = parseInt(f.tCount)
    f.transcripts = []
    f.sotype = f.type
    delete f.score
    delete f.phase
    delete f.type
    let sla = f.strand === '+' ? this.slap : this.slam
    f.genome = this.genome
    f.chr = this.chr
    //
    f.length = f.end - f.start + 1
    if (f.length > config.DataManager.featureSizeLimit) {
      console.log('Feature too big. Skipping: ', f)
      return null
    }
    // assign contig number
    f.contig = this.ca.assignNext(f.start, f.end)
    // assign lane for +/- strand style layout
    f.lane = sla.assignNext(f.start, f.end)
    // assign lane for spread-transcript style layout
    f.lane2 = this.fp.assignNext(f.start, f.end, Math.max(1, f.tCount), f.ID)
    this.id2feat[f.ID] = f
    if (f.cID) {
      let d = this.cid2feats[f.cID]
      if (!d) d = this.cid2feats[f.cID] = []
      d.push(f)
    }
    if (f.symbol) {
      let lc = f.symbol.toLowerCase()
      let d = this.symbol2feats[lc]
      if (!d) d = this.symbol2feats[lc] = []
      d.push(f)
    }
    // For convenience...
    f.id = f.cID || f.ID
    f.label = f.symbol || f.id
    // For performance. Don't want to observe 10,000s of objects.
    // Vue is not reactive to frozen objects.
    Object.freeze(f)
    //
    return f
  }
}

export default DataManager
