import u from '@/lib/utils'
import { connections } from '@/lib/InterMineServices'
import { translate } from '@/lib/genetic_code'

function getMenus(thisObj) {
  //
  function alignOption () {
    return {
      icon: 'format_align_center',
      label: cxt => `Align on ${cxt.feature.label}`,
      disabled: false,
      helpText: 'Aligns the displayed genomes around this feature.',
      handler: (function (cxt) {
        this.$root.$emit('feature-align', cxt)
      }).bind(thisObj)
    }
  }
  //
  function externalLinkOption (name, url) {
    return {
      icon: 'open_in_new',
      label: `Feature@${name}`,
      helpText: `See details for this feature at ${name}.`,
      disabled: false,
      extraArgs: [url],
      handler: (function (cxt, url) {
        const f = cxt.feature
        const u = url + f.ID
        window.open(u, '_blank')
      }).bind(thisObj)
    }
  }
  //
  // A sequence descriptor takes one of two forms depending on whether the
  // sequence is associated with a specific object or is an arbitrary slice of the genome.
  //
  // An object sequence descriptor has these fields:
  // - genome (string) Name of the genome the sequence is from.
  // - ID (string) primary identifier of the object (eg a transcript ID)
  // - type (string) type of sequence. One of: dna, transcript, cds
  // - length (int) length of the requested sequence
  // - header (string) the fasta header to use for the result
  // - selected (boolean) True iff the sequence is in the selected state.
  //
  // A sequence descriptor may also specify an arbitrary genomic segment
  // specified by address.
  // The descriptor is an object with these fields:
  // - genome (string) name of the genome
  // - chr (string) the chromosome
  // - start (int) start coordinate
  // - end (int) end coordinate of the region
  // - type (string) always 'dna'
  // - reverseComplement (boolean) True iff the sequence should be reverse complemented 
  // - selected (boolean) True iff the sequence is in the selected state
  // - length (int) length of the sequence
  //
  function makeDescriptor (stype, f, t) {
    const id = t ? (stype === 'cds' ? t.cds.ID : t.ID) : f.ID
    const len = t ? (stype === 'cds' ? t.cds.length : t.length) : f.length
    const sym = f.symbol || ''
    const gn = f.genome.name
    const parts = t ? (stype === 'cds' ? t.cds.pieces : t.exons) : [f]
    const starts = parts.map(p => p.start)
    const lengths = parts.map(p => p.end - p.start + 1)
    const d = {
      selected: true,
      genome: f.genome.name,
      genomeUrl: f.genome.url,
      type: stype,
      ID: id,
      header: `${gn}::${id} ${sym} (${stype})`,
      chromosome: f.chr.name,
      start: starts,
      length: lengths,
      totalLength: len,
      reverseComplement: f.strand === '-',
      translate: false
    }
    return d
  }
  //
  function sequenceSelectionOption (type) {
    const lbl = `All genolog ${type} sequences`
    const hlp = `Adds ${type} sequences to your cart for this feature from all currently displayed genomes.`
    return {
      icon: 'shopping_cart',
      label: lbl,
      helpText: hlp,
      disabled: cxt => cxt.feature.sotype !== 'protein_coding_gene' && type === 'cds',
      extraArgs: [type],
      handler: (function (cxt, seqtype) {
        const f = cxt.feature
        const genologs = this.dataManager().getGenologs(f, this.context.strips.map(s => s.genome)).filter(x => x)
        const seqs = genologs.map(f => {
          if (seqtype === 'dna') {
            return makeDescriptor(seqtype, f)
          } else if (seqtype === 'transcript') {
            return f.transcripts.map(t => {
              return makeDescriptor(seqtype, f, t)
            })
          } else if (seqtype === 'cds') {
            return f.transcripts.filter(t => t.cds).map(t => {
              return makeDescriptor(seqtype, f, t)
            })
          } else {
            u.fail('Unknown sequence type: ' + seqtype)
          }
        }).reduce((a,v) => {
          // flatten array where some elements are also arrays
          if (Array.isArray(v)) {
            return a.concat(v)
          } else {
            a.push(v)
            return a
          }
        }, [])
        this.$root.$emit('sequence-selected', seqs)
      }).bind(thisObj)
    }
  }
  //
  const mouseMenu = [
    alignOption(),
    {
      icon: '',
      label: `Link outs`,
      menuItems: [
        externalLinkOption('MGI', 'http://www.informatics.jax.org/accession/'),
        externalLinkOption('MouseMine', 'http://www.mousemine.org/mousemine/portal.do?class=Gene&externalids=')
      ]
    }, {
     label: 'Add sequences to cart',
     helpText: 'Add sequences to cart',
     menuItems: [
      {
        icon: 'shopping_cart',
        label: cxt => `Genomic ${cxt.feature.ID}`,
        helpText: cxt => `Genomic ${cxt.feature.ID}.`,
        handler: (function (cxt) {
          const f = cxt.feature
          if (!f) return
          this.$root.$emit('sequence-selected', [makeDescriptor('dna', f)])
        }).bind(thisObj)
      }, {
        icon: 'shopping_cart',
        label: cxt => `Transcript ${cxt.transcript ? cxt.transcript.ID : ''}`,
        helpText: cxt => `Transcript ${cxt.transcript ? cxt.transcript.ID : ''}.`,
        disabled: cxt => !cxt.transcript,
        handler: (function (cxt) {
          const f = cxt.feature
          const t = cxt.transcript
          if (!t) return
          this.$root.$emit('sequence-selected', [makeDescriptor('transcript', f, t)])
        }).bind(thisObj)
      }, {
        icon: 'shopping_cart',
        label: cxt => `CDS ${cxt.transcript && cxt.transcript.cds ? cxt.transcript.cds.ID : ''}`,
        helpText: cxt => `CDS ${cxt.transcript && cxt.transcript.cds ? cxt.transcript.cds.ID : ''}.`,
        disabled: cxt => !cxt.transcript || !cxt.transcript.cds,
        handler: (function (cxt) {
          const f = cxt.feature
          const t = cxt.transcript
          if (!t) return
          this.$root.$emit('sequence-selected', [makeDescriptor('cds', f, t)])
        }).bind(thisObj)
      },
      sequenceSelectionOption('dna'),
      sequenceSelectionOption('transcript'),
      sequenceSelectionOption('cds')
     ]
    }
  ]

  return {
    '10089': mouseMenu,
    '10090': mouseMenu,
    '10093': mouseMenu,
    '10096': mouseMenu,
    'default': [ alignOption() ]
  }
}

export default getMenus
