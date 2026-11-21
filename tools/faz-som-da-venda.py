#!/usr/bin/env python3
# ============================================================
# O SOM DA VENDA — A BANCADA DE PROJETO
#
# ATENCAO: este arquivo NAO e o som que toca no sistema.
#
# O que toca na televisao e public/js/meta-som.js, que monta o som
# no navegador na hora. Nenhum MP3 e publicado: sem arquivo para
# baixar, sem licenca de banco de audio tocando o dia inteiro na
# parede da empresa, e o sistema continua sem dependencia nenhuma.
#
# Este script existe para PROJETAR o som com calma e gerar MP3 de
# referencia para ouvir fora do navegador. O desenho nasceu aqui e
# foi portado nota por nota para o meta-som.js. Mexer aqui nao muda
# nada no sistema — e proposital: audio se afina ouvindo, e ouvir
# um WAV num player e mais rapido do que recarregar um painel.
#
# Uso:  python3 -I tools/faz-som-da-venda.py
#
# Tres candidatos, uns 5 segundos cada, feitos aqui e nao baixados
# de lugar nenhum: som de banco de audio tem licenca, e licenca de
# audio tocando o dia inteiro na parede de uma empresa e dor de
# cabeca que ninguem precisa. Sintetizado e da casa.
#
# O que faz um som soar "caro" em vez de "bipe de micro-ondas":
#
#  1. TRANSIENTE. Os primeiros 20 milissegundos decidem tudo. Um
#     estalo curto de ruido filtrado faz o som "cortar" o barulho
#     do escritorio; sem ele, qualquer nota soa mole.
#
#  2. PARCIAIS INARMONICOS. Sino de verdade nao vibra em multiplos
#     exatos da fundamental. Usar 2.76x, 5.40x, 8.93x (as razoes
#     medidas em sinos reais) e o que separa "sino" de "flauta".
#
#  3. CADA PARCIAL DECAI NUM TEMPO. O agudo some rapido, o grave
#     sustenta. Se todos decaem juntos, o ouvido ouve orgao.
#
#  4. REVERB. Som seco soa como alarme de celular. Quatro combs em
#     paralelo e dois allpass em serie (o reverb do Schroeder, de
#     1962) ja dao a sensacao de sala.
#
#  5. ESTEREO. Os dois lados levemente diferentes: o som ocupa a
#     parede em vez de sair de um ponto.
# ============================================================
import numpy as np
from scipy.signal import lfilter
import wave, sys, os

SR = 44100
SAIDA = os.path.dirname(os.path.abspath(__file__))


def t(dur):
    return np.linspace(0, dur, int(SR * dur), endpoint=False)


def env_perc(n, ataque, queda, curva=3.0):
    """Envelope de percussao: sobe quase instantaneo, cai exponencial."""
    e = np.zeros(n)
    na = max(1, int(SR * ataque))
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na) ** 0.6
    resto = n - na
    if resto > 0:
        x = np.linspace(0, 1, resto)
        e[na:] = np.exp(-curva * x * (1.0 / max(queda, 1e-6)) * 1.0)
    return e


def decai(n, segundos):
    """Queda exponencial que chega perto de zero em `segundos`."""
    x = np.arange(n) / SR
    return np.exp(-x / max(segundos, 1e-6) * 4.0)


def sino(freq, dur, parciais=None, brilho=1.0):
    """Sino aditivo com parciais inarmonicos e decaimentos diferentes."""
    if parciais is None:
        # razoes aproximadas de um sino de bronze
        parciais = [(0.50, 0.28, 1.70), (1.00, 1.00, 1.00), (2.00, 0.32, 0.70),
                    (2.76, 0.26, 0.52), (4.07, 0.14, 0.36), (5.40, 0.10, 0.26),
                    (8.93, 0.05, 0.16)]
    n = int(SR * dur)
    x = t(dur)
    saida = np.zeros(n)
    for razao, amp, vida in parciais:
        f = freq * razao
        if f > SR / 2.2:
            continue
        # um batimento leve: duas senoides quase iguais, que e o que
        # faz o sino "tremer" em vez de ficar parado
        bat = 0.6 + 0.4 * np.cos(2 * np.pi * 0.7 * razao * x)
        onda = np.sin(2 * np.pi * f * x) + 0.5 * np.sin(2 * np.pi * (f * 1.003) * x)
        saida += amp * (brilho ** (razao / 3)) * onda * decai(n, dur * vida) * bat
    return saida / (np.max(np.abs(saida)) + 1e-9)


def fm(freq, dur, razao=1.4, indice=6.0, vida_ind=0.25):
    """Sino FM: timbre metalico e brilhante, barato e eficaz."""
    n = int(SR * dur)
    x = t(dur)
    mod = np.sin(2 * np.pi * freq * razao * x) * indice * decai(n, dur * vida_ind)
    return np.sin(2 * np.pi * freq * x + mod) * decai(n, dur)


def estalo(dur=0.06, corte=2200):
    """O transiente: ruido com passa-altas e queda muito rapida."""
    n = int(SR * dur)
    r = np.random.RandomState(7).randn(n)
    # passa-altas de 1a ordem
    a = np.exp(-2 * np.pi * corte / SR)
    r = lfilter([1, -1], [1, -a], r)
    return r * decai(n, dur * 0.22)


def thump(freq=70, dur=0.5):
    """Corpo grave: da peso sem precisar de volume."""
    n = int(SR * dur)
    x = t(dur)
    # a frequencia cai, que e o que faz soar "bumbo" e nao "nota"
    f = freq * (1 + 1.6 * np.exp(-x * 26))
    fase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(fase) * decai(n, dur * 0.4)


def comb(sinal, atraso_ms, g):
    D = max(1, int(SR * atraso_ms / 1000.0))
    a = np.zeros(D + 1); a[0] = 1.0; a[D] = -g
    return lfilter([1.0], a, sinal)


def allpass(sinal, atraso_ms, g):
    D = max(1, int(SR * atraso_ms / 1000.0))
    b = np.zeros(D + 1); b[0] = -g; b[D] = 1.0
    a = np.zeros(D + 1); a[0] = 1.0; a[D] = -g
    return lfilter(b, a, sinal)


def reverb(sinal, mistura=0.28, tamanho=1.0):
    """Schroeder: 4 combs em paralelo, 2 allpass em serie."""
    combs = [(29.7, 0.78), (37.1, 0.76), (41.1, 0.75), (43.7, 0.73)]
    molhado = np.zeros_like(sinal)
    for ms, g in combs:
        molhado += comb(sinal, ms * tamanho, g * 0.92)
    molhado /= len(combs)
    molhado = allpass(molhado, 5.0 * tamanho, 0.7)
    molhado = allpass(molhado, 1.7 * tamanho, 0.7)
    return (1 - mistura) * sinal + mistura * molhado


def pad(freqs, dur, ataque=0.18, solta=1.4, amps=None, detune=0.0045, brilho=1.0):
    """Acorde que SE SUSTENTA.

    Era isto que faltava na primeira versao. So com sinos e arpejo o
    som morria em dois segundos: media 1% de energia aos 4s, ou seja,
    o arquivo tinha 5 segundos mas a celebracao durava dois. Um sino
    decai porque e assim que sino funciona; para ocupar cinco
    segundos sem repetir nota, precisa de algo que segure embaixo.

    Tres osciladores levemente desafinados por nota (o truque do
    "coro"): sozinho, um oscilador soa sintetizador barato; tres
    brigando de leve entre si soam instrumento.
    """
    n = int(SR * dur)
    x = t(dur)
    out = np.zeros(n)
    for j, f in enumerate(freqs):
        a = amps[j] if amps else 1.0 / (j + 1.7)
        for k, dt in enumerate([-detune, 0.0, detune]):
            vib = 1 + 0.0035 * np.sin(2 * np.pi * (4.1 + 0.8 * k) * x + k)
            fase = 2 * np.pi * np.cumsum(f * (1 + dt) * vib) / SR
            onda = (np.sin(fase)
                    + 0.24 * brilho * np.sin(2 * fase)
                    + 0.09 * brilho * np.sin(3 * fase)
                    + 0.04 * brilho * np.sin(5 * fase))
            out += a * onda / 3.0

    env = np.ones(n)
    na = max(1, int(SR * ataque))
    env[:na] = np.linspace(0, 1, na) ** 1.7
    nr = max(1, int(SR * solta))
    env[-nr:] *= np.linspace(1, 0, nr) ** 1.9
    # respiracao lenta: sem isto o acorde parado vira zumbido de geladeira
    env *= 0.84 + 0.16 * np.sin(2 * np.pi * 0.85 * x - 1.2)
    out = out * env
    return out / (np.max(np.abs(out)) + 1e-9)


def riser(dur=0.9, de=200, ate=2400):
    """Ruido subindo: prepara o ouvido para o golpe que vem."""
    n = int(SR * dur)
    r = np.random.RandomState(11).randn(n)
    x = np.linspace(0, 1, n)
    saida = np.zeros(n)
    # filtro passa-faixa varrendo para cima, em pedacos
    passo = 1024
    for i in range(0, n, passo):
        f = de + (ate - de) * (i / max(n - 1, 1)) ** 1.8
        a = np.exp(-2 * np.pi * f / SR)
        pedaco = lfilter([1 - a], [1, -a], r[i:i + passo])
        pedaco = lfilter([1, -1], [1, -np.exp(-2 * np.pi * (f * 0.6) / SR)], pedaco)
        saida[i:i + passo] = pedaco
    return saida * (x ** 2.2) / (np.max(np.abs(saida)) + 1e-9)


def poe(base, trecho, quando):
    """Soma `trecho` em `base` comecando no segundo `quando`."""
    i = int(SR * quando)
    fim = min(len(base), i + len(trecho))
    if fim > i:
        base[i:fim] += trecho[:fim - i]
    return base


def finaliza(mono_l, mono_r, dur, nome, pico_db=-1.2):
    n = int(SR * dur)
    L = np.zeros(n); R = np.zeros(n)
    L[:min(n, len(mono_l))] = mono_l[:n]
    R[:min(n, len(mono_r))] = mono_r[:n]

    # Rampa de saida: cortar audio no meio da onda estala.
    fim = int(SR * 0.25)
    rampa = np.linspace(1, 0, fim) ** 1.5
    L[-fim:] *= rampa; R[-fim:] *= rampa

    st = np.stack([L, R], axis=1)
    # Compressor de pico bem suave (tanh), so para encorpar
    st = np.tanh(st * 1.15) / np.tanh(1.15)
    pico = np.max(np.abs(st)) + 1e-9
    st = st / pico * (10 ** (pico_db / 20.0))

    dados = (st * 32767).astype(np.int16)
    caminho = os.path.join(SAIDA, nome + '.wav')
    with wave.open(caminho, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(dados.tobytes())
    print('  ' + nome + '.wav  ' + str(round(dur, 2)) + 's  pico ' +
          str(round(20 * np.log10(np.max(np.abs(st)) + 1e-9), 2)) + ' dBFS')
    return caminho


# notas
C5, E5, G5, C6, E6, G6 = 523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98
G4, C4 = 392.00, 261.63

# ============================================================
# A — FANFARRA DE VENDA
#
# Estrutura de cinco segundos de verdade, com comeco, meio e fim:
#   0,0s  o golpe (cha-ching + peso grave)
#   0,2s  a subida de quatro notas
#   0,6s  o acorde maior abre e SEGURA
#   1,8s  um realce, para nao virar nota parada
#   2,7s  segundo realce, uma oitava acima
#   3,5s  a resolucao, com cauda ate o fim
# ============================================================
def faz_a():
    DUR = 5.2
    n = int(SR * DUR)
    s = np.zeros(n)

    # o golpe
    poe(s, 0.32 * estalo(0.05, 3000), 0.00)
    poe(s, 0.30 * thump(85, 0.55), 0.00)
    poe(s, 0.50 * sino(2100, 0.22, brilho=1.3), 0.00)
    poe(s, 0.38 * sino(2640, 0.30, brilho=1.3), 0.055)

    # a subida
    for i, f in enumerate([C5, E5, G5, C6]):
        poe(s, (0.30 - i * 0.018) * fm(f, 1.0 + i * 0.25, razao=1.41, indice=5.2), 0.18 + i * 0.10)

    # O COLCHAO: o acorde maior sustentado, que e quem ocupa a tela
    poe(s, 0.50 * pad([C4, G4, C5, E5, G5, C6], 4.3, ataque=0.14, solta=1.7,
                      amps=[0.30, 0.20, 0.26, 0.21, 0.15, 0.10]), 0.55)

    # o ataque do acorde (o pad sozinho entra mole demais)
    for f, a in [(C4, 0.22), (C5, 0.22), (E5, 0.17), (G5, 0.13)]:
        poe(s, a * sino(f, 2.6, brilho=1.0), 0.56)

    # realce 1 — a quinta, no meio
    poe(s, 0.20 * sino(G5, 2.4, brilho=1.1), 1.80)
    poe(s, 0.09 * fm(E6, 1.6, razao=2.01, indice=3.0), 1.84)

    # realce 2 — uma oitava acima
    poe(s, 0.19 * sino(C6, 2.2, brilho=1.1), 2.70)
    poe(s, 0.08 * fm(G6, 1.4, razao=2.01, indice=2.6), 2.76)

    # a resolucao e a cauda
    poe(s, 0.30 * sino(C5, 2.4, brilho=1.0), 3.50)
    poe(s, 0.16 * sino(C4, 2.2, brilho=0.9), 3.50)
    poe(s, 0.07 * fm(C6 * 2, 1.3, razao=3.01, indice=2.0), 3.58)

    molhado = reverb(s, mistura=0.30, tamanho=1.05)
    d = int(SR * 0.009)
    R = np.concatenate([np.zeros(d), molhado[:-d]]) * 0.94
    return finaliza(molhado, R, DUR, 'hit-fanfarra')


# ============================================================
# B — HIT DE CONQUISTA
#
# O mais "game": murro na cara, subida rapida, acorde que segura,
# e um riser no meio que prepara o segundo golpe.
# ============================================================
def faz_b():
    DUR = 5.2
    n = int(SR * DUR)
    s = np.zeros(n)

    poe(s, 0.42 * estalo(0.07, 1800), 0.00)
    poe(s, 0.45 * thump(62, 0.75), 0.00)

    for i, f in enumerate([G4, C5, E5, G5, C6]):
        poe(s, (0.27 - i * 0.012) * fm(f, 0.85, razao=2.0, indice=4.0, vida_ind=0.18), i * 0.078)

    poe(s, 0.24 * estalo(0.04, 4000), 0.40)
    for f, a in [(C4, 0.22), (C5, 0.24), (E5, 0.19), (G5, 0.15)]:
        poe(s, a * sino(f, 3.0, brilho=1.1), 0.41)

    poe(s, 0.46 * pad([C4, G4, C5, E5, G5], 3.1, ataque=0.10, solta=1.1,
                      amps=[0.30, 0.19, 0.25, 0.20, 0.14], brilho=1.2), 0.44)

    # o riser leva ao segundo golpe
    poe(s, 0.17 * riser(0.95, 260, 3200), 1.55)
    poe(s, 0.34 * estalo(0.06, 2400), 2.52)
    poe(s, 0.34 * thump(58, 0.7), 2.52)
    for f, a in [(C4, 0.20), (C5, 0.22), (G5, 0.18), (C6, 0.14)]:
        poe(s, a * sino(f, 2.6, brilho=1.15), 2.54)
    poe(s, 0.40 * pad([C4, G4, C5, E5, G5, C6], 2.5, ataque=0.06, solta=1.3,
                      amps=[0.28, 0.18, 0.24, 0.19, 0.14, 0.10], brilho=1.25), 2.55)

    # faiscas caindo na cauda
    for f, q in [(C6, 3.15), (E6, 3.45), (G6, 3.75), (C6 * 2, 4.05)]:
        poe(s, 0.065 * fm(f, 1.2, razao=3.01, indice=2.2), q)

    molhado = reverb(s, mistura=0.32, tamanho=1.15)
    d = int(SR * 0.011)
    R = np.concatenate([np.zeros(d), molhado[:-d]]) * 0.93
    return finaliza(molhado, R, DUR, 'hit-conquista')


# ============================================================
# C — SINO DE PREGÃO
#
# O mais sobrio: abertura de bolsa, nao videogame. Badalada grande,
# acorde grave segurando embaixo, segunda badalada, cauda longa.
# ============================================================
def faz_c():
    DUR = 5.4
    n = int(SR * DUR)
    s = np.zeros(n)

    poe(s, 0.30 * estalo(0.09, 1200), 0.00)
    poe(s, 0.32 * thump(55, 0.95), 0.00)

    poe(s, 0.58 * sino(C5 / 2, 4.4, brilho=1.05), 0.00)
    poe(s, 0.24 * sino(G4, 3.6, brilho=1.0), 0.012)
    poe(s, 0.15 * sino(C5, 3.0, brilho=1.0), 0.03)

    # o colchao grave, entrando devagar por baixo da badalada
    poe(s, 0.42 * pad([C4 / 2, C4, G4, C5, E5], 4.4, ataque=0.55, solta=1.9,
                      amps=[0.26, 0.28, 0.19, 0.22, 0.14], brilho=0.8), 0.20)

    # segunda badalada
    poe(s, 0.34 * sino(C5 / 2, 3.4, brilho=0.98), 1.70)
    poe(s, 0.14 * sino(G4, 2.8, brilho=0.95), 1.72)

    # terceira, mais fraca, fechando
    poe(s, 0.22 * sino(C5 / 2, 2.8, brilho=0.92), 3.30)
    poe(s, 0.09 * sino(C5, 2.2, brilho=0.92), 3.33)

    poe(s, 0.08 * fm(E5, 2.4, razao=1.5, indice=2.6), 0.10)
    poe(s, 0.06 * fm(G5, 2.0, razao=1.5, indice=2.0), 1.78)

    molhado = reverb(s, mistura=0.36, tamanho=1.35)
    d = int(SR * 0.013)
    R = np.concatenate([np.zeros(d), molhado[:-d]]) * 0.92
    return finaliza(molhado, R, DUR, 'hit-pregao')


if __name__ == '__main__':
    print('gerando:')
    faz_a(); faz_b(); faz_c()
    print('pronto')
